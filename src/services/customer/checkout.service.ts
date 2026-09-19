import crypto from "crypto";

import prisma from "../../config/prisma";
import razorpay from "../../config/razorpay";
import type { Payments } from "razorpay/dist/types/payments";
import { getEffectivePricesForVariants } from "./offer-pricing.service";

import AppError from "../../errors/AppError";

import {
  Prisma,
  CouponDiscountType,
} from "../../../generated/prisma/client";

import {
  withTransactionRetry,
  isUniqueConstraintOn,
} from "../../utils/transaction-retry.util";

import { consumeCouponClaim } from "../../utils/coupon-redemption.util";

import { reserveStockOrThrow } from "../../utils/stock.util";

import { assertPurchasable } from "../../utils/purchasable.util";

import { startOfBusinessDayUtc } from "../../utils/date-range.util";

import { issueRefundForOrder } from "../refund.service";

import { logError } from "../../utils/logger.util";

import { syncCartPriceSnapshots } from "./cart.service";

const ONLINE_PAYMENT_WINDOW_MS =
  15 * 60 * 1000;

/*
 * Every unpaid online order holds its stock for the payment window.
 * Capping how many a customer may hold at once stops one account from
 * making products look sold out by opening checkouts it never pays.
 */
export const MAX_OPEN_ONLINE_ORDERS_PER_USER = 3;

const ZERO = new Prisma.Decimal(0);

export function toPaise(
  amount: Prisma.Decimal
): number {
  return amount
    .mul(100)
    .toDecimalPlaces(0)
    .toNumber();
}

// ============================================================
// CART
// ============================================================

const CART_ITEM_INCLUDE = {
  productVariant: {
    include: {
      size: true,
      productColor: {
        include: {
          color: true,
          product: {
            include: {
              category: { select: { isActive: true } },
            },
          },
        },
      },
    },
  },
} as const;

// ============================================================
// TYPES
// ============================================================

type TransactionClient =
  Parameters<
    Parameters<typeof prisma.$transaction>[0]
  >[0];

type ShippingSnapshot =
  ReturnType<typeof createShippingSnapshot>;

// ============================================================
// COUPON HELPERS
// ============================================================

function normalizeCouponCode(
  code: string
): string {
  return code
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function isCouponCurrentlyValid(
  coupon: {
    isActive: boolean;
    startsOn: Date;
    expiresOn: Date;
  },
  today: Date
): boolean {
  return (
    coupon.isActive &&
    today >= coupon.startsOn &&
    today <= coupon.expiresOn
  );
}

function calculateCouponDiscount(
  coupon: {
    discountType: CouponDiscountType;
    discountValue: Prisma.Decimal;
    minimumOrderAmount: Prisma.Decimal;
    maximumDiscountAmount: Prisma.Decimal | null;
  },
  subtotal: Prisma.Decimal
): Prisma.Decimal {
  const {
    minimumOrderAmount,
    discountValue,
    maximumDiscountAmount,
  } = coupon;

  if (subtotal.lt(minimumOrderAmount)) {
    throw new AppError(
      `Minimum order amount is ₹${minimumOrderAmount.toFixed(
        2
      )}`,
      400
    );
  }

  let discountAmount: Prisma.Decimal;

  if (
    coupon.discountType ===
    CouponDiscountType.PERCENTAGE
  ) {
    discountAmount = subtotal
      .mul(discountValue)
      .div(100)
      .toDecimalPlaces(2);

    if (
      maximumDiscountAmount !== null
    ) {
      discountAmount = Prisma.Decimal.min(
        discountAmount,
        maximumDiscountAmount
      );
    }
  } else {
    discountAmount = Prisma.Decimal.min(
      discountValue,
      subtotal
    );
  }


  discountAmount = Prisma.Decimal.min(
    discountAmount,
    subtotal
  );

  return Prisma.Decimal.max(
    discountAmount,
    ZERO
  ).toDecimalPlaces(2);
}


async function getCheckoutCoupon(
  tx: TransactionClient,
  userId: number,
  couponCode: string | undefined,
  subtotal: Prisma.Decimal
): Promise<{
  couponCode: string | null;
  couponDiscount: Prisma.Decimal;
  couponId: number | null;
  couponClaimId: number | null;
}> {
  /*
   * No coupon was selected.
   */
  if (!couponCode) {
    return {
      couponCode: null,
      couponDiscount: ZERO,
      couponId: null,
      couponClaimId: null,
    };
  }

  const normalizedCode =
    normalizeCouponCode(couponCode);

  const coupon =
    await tx.coupon.findUnique({
      where: {
        code: normalizedCode,
      },
      select: {
        id: true,
        code: true,
        isActive: true,
        startsOn: true,
        expiresOn: true,
        discountType: true,
        discountValue: true,
        minimumOrderAmount: true,
        maximumDiscountAmount: true,
        usageLimit: true,
        usedCount: true,
      },
    });

  if (!coupon) {
    throw new AppError(
      "Coupon not found",
      404
    );
  }

  const today = startOfBusinessDayUtc();

  if (
    !isCouponCurrentlyValid(
      coupon,
      today
    )
  ) {
    throw new AppError(
      "Coupon is not currently valid",
      400
    );
  }

  /*
   * The user must have claimed the coupon first.
   */
  const claim =
    await tx.couponClaim.findUnique({
      where: {
        couponId_userId: {
          couponId: coupon.id,
          userId,
        },
      },
      select: {
        id: true,
        usedAt: true,
      },
    });

  if (!claim) {
    throw new AppError(
      "You must claim this coupon before using it",
      400
    );
  }


  if (claim.usedAt !== null) {
    throw new AppError(
      "You have already used this coupon",
      400
    );
  }

  if (
    coupon.usageLimit !== null &&
    coupon.usedCount >= coupon.usageLimit
  ) {
    throw new AppError(
      "This coupon has reached its usage limit",
      409
    );
  }

  const couponDiscount =
    calculateCouponDiscount(
      coupon,
      subtotal
    );

  return {
    couponCode: coupon.code,
    couponDiscount,
    couponId: coupon.id,
    couponClaimId: claim.id,
  };
}



async function getCartForCheckout(
  tx: TransactionClient,
  cartId: number
) {
  const cart = await tx.cart.findUniqueOrThrow({
    where: {
      id: cartId,
    },
    include: {
      items: {
        include: CART_ITEM_INCLUDE,
      },
    },
  });

  /*
   * Deterministic ordering prevents a class
   * of deadlocks when multiple transactions
   * reserve the same variants.
   */
  cart.items.sort(
    (a, b) =>
      a.productVariantId -
      b.productVariantId
  );

  // Re-checked inside the transaction: an item deactivated after it was
  // added to the cart must not be sold (M3).
  for (const item of cart.items) {
    assertPurchasable(item.productVariant);
  }

  /*
   * Calculate the current effective price
   * for every variant in the cart.
   */
  const variantInputs = cart.items.map((item) => ({
    id: item.productVariantId,
    price: item.productVariant.price,
    productId:
      item.productVariant.productColor.product.id,
    categoryId:
      item.productVariant.productColor.product.categoryId,
  }));

  const effectivePrices =
    await getEffectivePricesForVariants(
      variantInputs,
      tx
    );

  return {
    ...cart,
    effectivePrices,
  };
}



function buildOrderItemsData(
  items: Array<{
    productVariantId: number;
    quantity: number;
    productVariant: {
      price: Prisma.Decimal;
      size: {
        name: string;
      };
      productColor: {
        color: {
          name: string;
        };
        product: {
          name: string;
        };
      };
    };
  }>,
  effectivePrices: Map<
    number,
    {
      originalPrice: number;
      finalPrice: number;
      discountPercentage: number | null;
      offerSource: "PRODUCT" | "CATEGORY" | null;
    }
  >
) {
  return items.map((item) => {
    const pricing = effectivePrices.get(
      item.productVariantId
    );

    if (!pricing) {
      throw new AppError(
        "Unable to calculate product price",
        500
      );
    }

    return {
      productVariantId: item.productVariantId,

      productName:
        item.productVariant.productColor.product.name,

      colorName:
        item.productVariant.productColor.color.name,

      sizeName:
        item.productVariant.size.name,

      // Store the actual effective price paid for this order.
      price: new Prisma.Decimal(pricing.finalPrice),

      quantity: item.quantity,
      remainingQuantity: item.quantity,
      cancelledQuantity: 0,
      returnedQuantity: 0,
    };
  });
}


function calculateSubtotal(
  items: Array<{
    quantity: number;
    productVariantId: number;
  }>,
  effectivePrices: Map<
    number,
    {
      originalPrice: number;
      finalPrice: number;
      discountPercentage: number | null;
      offerSource:
        | "PRODUCT"
        | "CATEGORY"
        | null;
    }
  >
): Prisma.Decimal {
  return items
    .reduce((sum, item) => {
      const pricing =
        effectivePrices.get(
          item.productVariantId
        );

      if (!pricing) {
        throw new AppError(
          "Unable to calculate product price",
          500
        );
      }

      return sum.add(
        new Prisma.Decimal(
          pricing.finalPrice
        ).mul(item.quantity)
      );
    }, ZERO)
    .toDecimalPlaces(2);
}

function createShippingSnapshot(
  address: {
    firstName: string;
    lastName: string | null;
    phone: string;
    addressLine1: string;
    addressLine2: string;
    landmark: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  }
) {
  return {
    shippingFirstName:
      address.firstName,

    shippingLastName:
      address.lastName,

    shippingPhone:
      address.phone,

    shippingLine1:
      address.addressLine1,

    shippingLine2:
      address.addressLine2,

    shippingLandmark:
      address.landmark,

    shippingCity:
      address.city,

    shippingState:
      address.state,

    shippingPostalCode:
      address.postalCode,

    shippingCountry:
      address.country,
  };
}

/**
 * Once an online order is paid, what it bought leaves the cart (M10).
 * Only those quantities: anything the customer added meanwhile stays.
 */
async function removePurchasedFromCart(
  tx: TransactionClient,
  userId: number,
  items: Array<{ productVariantId: number; quantity: number }>
) {
  const cart = await tx.cart.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!cart || items.length === 0) {
    return;
  }

  for (const item of items) {
    await tx.cartItem.updateMany({
      where: {
        cartId: cart.id,
        productVariantId: item.productVariantId,
      },
      data: { quantity: { decrement: item.quantity } },
    });
  }

  await tx.cartItem.deleteMany({
    where: { cartId: cart.id, quantity: { lte: 0 } },
  });
}

export const PRICE_CHANGED_MESSAGE =
  "Prices in your cart have changed. Please review the new total before placing your order.";

/** Refuses to create an order at a total the customer never saw. */
function assertExpectedTotal(
  total: Prisma.Decimal,
  expectedTotal: string | undefined
) {
  if (
    expectedTotal !== undefined &&
    !total.equals(new Prisma.Decimal(expectedTotal))
  ) {
    throw new AppError(PRICE_CHANGED_MESSAGE, 409, "PRICE_CHANGED");
  }
}

// ============================================================
// IDEMPOTENCY
// ============================================================

type CheckoutRequest = {
  paymentMethod:
    | "COD"
    | "ONLINE";
  contactEmail: string;
  contactPhone: string;
  shippingSnapshot: ShippingSnapshot;
  couponCode?: string;
};

function matchesCheckoutRequest(
  order: ShippingSnapshot & {
    paymentMethod: string;
    contactEmail: string;
    contactPhone: string;
    couponCode: string | null;
  },
  request: CheckoutRequest
): boolean {
  if (
    order.paymentMethod !==
      request.paymentMethod ||
    order.contactEmail !==
      request.contactEmail ||
    order.contactPhone !==
      request.contactPhone
  ) {
    return false;
  }

  const requestCouponCode =
    request.couponCode
      ? normalizeCouponCode(
          request.couponCode
        )
      : null;

  if (
    order.couponCode !==
    requestCouponCode
  ) {
    return false;
  }

  const shippingFields = Object.keys(
    request.shippingSnapshot
  ) as Array<
    keyof ShippingSnapshot
  >;

  return shippingFields.every(
    (field) =>
      order[field] ===
      request.shippingSnapshot[field]
  );
}

async function findOrderByIdempotencyKey(
  client:
    | TransactionClient
    | typeof prisma,
  idempotencyKey: string,
  userId: number,
  request: CheckoutRequest
) {
  const existing =
    await client.order.findFirst({
      where: {
        userId,
        idempotencyKey,
      },
      include: {
        items: true,
      },
    });

  if (!existing) {
    return null;
  }

  if (
    !matchesCheckoutRequest(
      existing,
      request
    )
  ) {
    throw new AppError(
      "This checkout was already submitted with different details. Please refresh the page and try again.",
      409
    );
  }

  return existing;
}


async function runCodCheckout(
  tx: TransactionClient,
  params: {
    userId: number;
    contactEmail: string;
    contactPhone: string;
    shippingSnapshot: ShippingSnapshot;
    idempotencyKey: string;
    couponCode?: string;
    expectedTotal?: string;
  }
) {
  const {
    userId,
    contactEmail,
    contactPhone,
    shippingSnapshot,
    idempotencyKey,
    couponCode,
    expectedTotal,
  } = params;

  /*
   * Lock the user's cart.
   */
  const lockedCart =
    await tx.$queryRaw<
      { id: number }[]
    >`
      SELECT id
      FROM "Cart"
      WHERE "userId" = ${userId}
      FOR UPDATE
    `;

  if (lockedCart.length === 0) {
    throw new AppError(
      "Your cart is empty",
      400
    );
  }

  const cart =
    await getCartForCheckout(
      tx,
      lockedCart[0].id
    );

  if (cart.items.length === 0) {

    const dup =
      await findOrderByIdempotencyKey(
        tx,
        idempotencyKey,
        userId,
        {
          paymentMethod: "COD",
          contactEmail,
          contactPhone,
          shippingSnapshot,
          couponCode,
        }
      );

    if (dup) {
      return dup;
    }

    throw new AppError(
      "Your cart is empty",
      400
    );
  }


  const subtotal =
  calculateSubtotal(
    cart.items,
    cart.effectivePrices
  );


  const coupon =
    await getCheckoutCoupon(
      tx,
      userId,
      couponCode,
      subtotal
    );

  const total = Prisma.Decimal.max(
    subtotal.sub(coupon.couponDiscount),
    ZERO
  ).toDecimalPlaces(2);

  assertExpectedTotal(total, expectedTotal);



  const order =
    await tx.order.create({
      data: {
        userId,

        contactEmail,

        contactPhone,

        status: "CONFIRMED",

        paymentMethod: "COD",

        paymentStatus: "PENDING",

        idempotencyKey,

        ...shippingSnapshot,

        subtotal,

        total,

        couponCode:
          coupon.couponCode,

        couponDiscount:
          coupon.couponDiscount,

        items: {
          create:
            buildOrderItemsData(
              cart.items,
              cart.effectivePrices
            ),
        },
      },

      include: {
        items: true,
      },
    });

  /*
   * Reserve stock. After the order items exist so every ORDER_PLACED
   * movement points at its order item (M11); same transaction, so a
   * shortage still rolls the order back.
   */
  await reserveStockOrThrow(
    tx,
    order.items.map((item) => ({
      productVariantId: item.productVariantId,
      quantity: item.quantity,
      orderItemId: item.id,
      productName: item.productName,
    }))
  );


  if (
    coupon.couponClaimId !== null &&
    coupon.couponId !== null
  ) {
    await consumeCouponClaim(tx, {
      claimId: coupon.couponClaimId,

      couponId: coupon.couponId,

      orderId: order.id,
    });
  }

  /*
   * Consume the cart.
   */
  await tx.cartItem.deleteMany({
    where: {
      cartId: cart.id,
    },
  });

  return order;
}


async function runOnlinePendingOrderCreation(
  tx: TransactionClient,
  params: {
    userId: number;
    contactEmail: string;
    contactPhone: string;
    shippingSnapshot: ShippingSnapshot;
    idempotencyKey: string;
    couponCode?: string;
    expectedTotal?: string;
  }
) {
  const {
    userId,
    contactEmail,
    contactPhone,
    shippingSnapshot,
    idempotencyKey,
    couponCode,
    expectedTotal,
  } = params;


  const lockedCart =
    await tx.$queryRaw<
      { id: number }[]
    >`
      SELECT id
      FROM "Cart"
      WHERE "userId" = ${userId}
      FOR UPDATE
    `;

  if (lockedCart.length === 0) {
    throw new AppError(
      "Your cart is empty",
      400
    );
  }

  const cart =
    await getCartForCheckout(
      tx,
      lockedCart[0].id
    );

  if (cart.items.length === 0) {
    const dup =
      await findOrderByIdempotencyKey(
        tx,
        idempotencyKey,
        userId,
        {
          paymentMethod: "ONLINE",
          contactEmail,
          contactPhone,
          shippingSnapshot,
          couponCode,
        }
      );

    if (dup) {
      return dup;
    }

    throw new AppError(
      "Your cart is empty",
      400
    );
  }


  const subtotal =
  calculateSubtotal(
    cart.items,
    cart.effectivePrices
  );


  const coupon =
    await getCheckoutCoupon(
      tx,
      userId,
      couponCode,
      subtotal
    );


  const total = Prisma.Decimal.max(
    subtotal.sub(coupon.couponDiscount),
    ZERO
  ).toDecimalPlaces(2);

  assertExpectedTotal(total, expectedTotal);

  const openOnlineOrders = await tx.order.count({
    where: {
      userId,
      paymentMethod: "ONLINE",
      status: "PENDING",
      paymentStatus: "PENDING",
      expiresAt: { gt: new Date() },
    },
  });

  if (openOnlineOrders >= MAX_OPEN_ONLINE_ORDERS_PER_USER) {
    throw new AppError(
      "You have unpaid orders waiting for payment. Please complete or cancel them before starting a new online checkout.",
      409
    );
  }


  const expiresAt = new Date(
    Date.now() +
      ONLINE_PAYMENT_WINDOW_MS
  );


  const order =
    await tx.order.create({
      data: {
        userId,

        contactEmail,

        contactPhone,

        status: "PENDING",

        paymentMethod: "ONLINE",

        paymentStatus: "PENDING",

        idempotencyKey,

        ...shippingSnapshot,

        subtotal,

        total,

        couponCode:
          coupon.couponCode,

        couponDiscount:
          coupon.couponDiscount,

        expiresAt,

        items: {
          create:
            buildOrderItemsData(
              cart.items,
              cart.effectivePrices
            ),
        },
      },

      include: {
        items: true,
      },
    });

  /*
   * Reserve stock. After the order items exist so every ORDER_PLACED
   * movement points at its order item (M11); same transaction, so a
   * shortage still rolls the order back.
   */
  await reserveStockOrThrow(
    tx,
    order.items.map((item) => ({
      productVariantId: item.productVariantId,
      quantity: item.quantity,
      orderItemId: item.id,
      productName: item.productName,
    }))
  );


  if (
    coupon.couponClaimId !== null &&
    coupon.couponId !== null
  ) {
    await consumeCouponClaim(tx, {
      claimId: coupon.couponClaimId,

      couponId: coupon.couponId,

      orderId: order.id,
    });
  }

  // The cart is kept until the payment is confirmed (M10): a failed or
  // abandoned payment must not leave the customer with an empty cart.
  // confirmOrderPayment removes the purchased quantities.

  return order;
}


const PAYMENT_INIT_FAILED =
  "Unable to initialize payment. Please try again.";

/**
 * The Razorpay order for a pending online order, created on first use or
 * after an earlier attempt failed (M10). Concurrent callers converge on
 * the stored id; a spare Razorpay order that loses the race is never paid.
 */
export async function ensureRazorpayOrder(order: {
  id: number;
  total: Prisma.Decimal;
  razorpayOrderId: string | null;
}): Promise<string> {
  if (order.razorpayOrderId) {
    return order.razorpayOrderId;
  }

  let created;

  try {
    created = await razorpay.orders.create({
      amount: toPaise(order.total),
      currency: "INR",
      receipt: `order_${order.id}`,
    });
  } catch (error) {
    // The order stays PENDING with its stock held; the customer can retry
    // (same key or /pay) and the sweeper releases it if they don't.
    logError("checkout.payment_init_failed", error, { orderId: order.id });

    throw new AppError(PAYMENT_INIT_FAILED, 502);
  }

  await prisma.order.updateMany({
    where: { id: order.id, razorpayOrderId: null },
    data: { razorpayOrderId: created.id },
  });

  const stored = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { razorpayOrderId: true },
  });

  return stored.razorpayOrderId!;
}

export const PAYMENT_ORDER_SELECT = {
  id: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  total: true,
  expiresAt: true,
} as const;

/** Refuses orders that can no longer take a payment. */
function assertPayable(order: {
  paymentMethod: string;
  status: string;
  paymentStatus: string;
  expiresAt: Date | null;
}) {
  if (order.paymentMethod !== "ONLINE") {
    throw new AppError("This order does not use online payment", 400);
  }

  if (order.paymentStatus === "PAID") {
    throw new AppError("This order is already paid", 409);
  }

  if (
    order.status !== "PENDING" ||
    order.paymentStatus !== "PENDING" ||
    (order.expiresAt !== null && order.expiresAt <= new Date())
  ) {
    throw new AppError("This order can no longer be paid", 409);
  }
}

async function onlineResponse<
  T extends {
    id: number;
    total: Prisma.Decimal;
    razorpayOrderId: string | null;
    status: string;
    paymentStatus: string;
    paymentMethod: string;
    expiresAt: Date | null;
  },
>(order: T) {
  // Never reopen a payment window for a paid, cancelled or expired order.
  assertPayable(order);

  const razorpayOrderId = await ensureRazorpayOrder(order);

  return {
    order: { ...order, razorpayOrderId },

    mode: "ONLINE" as const,

    razorpay: {
      orderId: razorpayOrderId,
      amount: toPaise(order.total),
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID!,
    },
  };
}

/** POST /customer/orders/:orderId/pay — reopen payment for an open order. */
export async function resumeOrderPayment(orderId: number, userId: number) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { ...PAYMENT_ORDER_SELECT, razorpayOrderId: true },
  });

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  assertPayable(order);

  const response = await onlineResponse(order);
  const { razorpayOrderId: _omit, ...publicOrder } = response.order;

  return { ...response, order: publicOrder };
}


async function runOnlineCheckout(
  params: {
    userId: number;
    contactEmail: string;
    contactPhone: string;
    shippingSnapshot: ShippingSnapshot;
    idempotencyKey: string;
    couponCode?: string;
    expectedTotal?: string;
  }
) {
  const {
    userId,
    contactEmail,
    contactPhone,
    shippingSnapshot,
    idempotencyKey,
    couponCode,
    expectedTotal,
  } = params;

  const checkoutRequest: CheckoutRequest =
    {
      paymentMethod: "ONLINE",
      contactEmail,
      contactPhone,
      shippingSnapshot,
      couponCode,
    };

  const alreadyProcessed =
    await findOrderByIdempotencyKey(
      prisma,
      idempotencyKey,
      userId,
      checkoutRequest
    );

  // Same key again: reopen the same payment (re-initialising it if the
  // first attempt failed) instead of a dead-end 409.
  if (alreadyProcessed) {
    return onlineResponse(alreadyProcessed);
  }

  let pendingOrder;

  try {
    pendingOrder =
      await withTransactionRetry(
        () =>
          prisma.$transaction(
            (tx) =>
              runOnlinePendingOrderCreation(
                tx,
                {
                  userId,
                  contactEmail,
                  contactPhone,
                  shippingSnapshot,
                  idempotencyKey,
                  couponCode,
                  expectedTotal,
                }
              ),
            {
              isolationLevel:
                "Serializable",

              maxWait: 5000,

              timeout: 10000,
            }
          )
      );
  } catch (error) {

    if (
      isUniqueConstraintOn(
        error,
        "idempotencyKey"
      )
    ) {
      const dup =
        await findOrderByIdempotencyKey(
          prisma,
          idempotencyKey,
          userId,
          checkoutRequest
        );

      if (dup) {
        return onlineResponse(dup);
      }
    }

    throw error;
  }

  return onlineResponse(pendingOrder);
}



export const createCheckout = async (
  userId: number,
  addressId: number,
  contactEmail: string,
  contactPhone: string,
  paymentMethod:
    | "COD"
    | "ONLINE",
  idempotencyKey: string,
  couponCode?: string,
  expectedTotal?: string
) => {

  const address =
    await prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

  if (!address) {
    throw new AppError(
      "Address not found",
      404
    );
  }

  const repricedItems =
    await syncCartPriceSnapshots(userId);

  if (repricedItems > 0) {
    throw new AppError(
      "Prices in your cart have changed. Please review your cart before continuing.",
      409
    );
  }

  const shippingSnapshot =
    createShippingSnapshot(address);



  if (
    paymentMethod === "COD"
  ) {
    let order;

    try {
      order =
        await withTransactionRetry(
          () =>
            prisma.$transaction(
              (tx) =>
                runCodCheckout(tx, {
                  userId,
                  contactEmail,
                  contactPhone,
                  shippingSnapshot,
                  idempotencyKey,
                  couponCode,
                  expectedTotal,
                }),
              {
                isolationLevel:
                  "Serializable",

                maxWait: 5000,

                timeout: 10000,
              }
            )
        );
    } catch (error) {
      if (
        isUniqueConstraintOn(
          error,
          "idempotencyKey"
        )
      ) {
        const dup =
          await findOrderByIdempotencyKey(
            prisma,
            idempotencyKey,
            userId,
            {
              paymentMethod: "COD",
              contactEmail,
              contactPhone,
              shippingSnapshot,
              couponCode,
            }
          );

        if (dup) {
          return {
            order: dup,
            mode: "COD" as const,
          };
        }
      }

      throw error;
    }

    return {
      order,
      mode: "COD" as const,
    };
  }

  return runOnlineCheckout({
    userId,
    contactEmail,
    contactPhone,
    shippingSnapshot,
    idempotencyKey,
    couponCode,
    expectedTotal,
  });
};



export const ensurePaymentCaptured = async (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  expectedAmountInPaise: number
) => {
  let payment: Payments.RazorpayPayment;

  try {
    payment = await razorpay.payments.fetch(
      razorpayPaymentId
    );
  } catch (error) {
    console.error(
      `Unable to fetch Razorpay payment ${razorpayPaymentId}`,
      error
    );

    throw new AppError(
      "Unable to confirm this payment with the payment provider. Please try again.",
      502
    );
  }

  if (payment.order_id !== razorpayOrderId) {
    throw new AppError(
      "Payment verification failed",
      400
    );
  }

  if (payment.status === "failed") {
    throw new AppError(
      "This payment did not succeed",
      402
    );
  }

  if (
    Number(payment.amount) <
    expectedAmountInPaise
  ) {
    throw new AppError(
      "Payment amount does not match the order total",
      400
    );
  }

  if (payment.status === "authorized") {
    try {
      payment = await razorpay.payments.capture(
        razorpayPaymentId,
        payment.amount,
        payment.currency
      );
    } catch (error) {
      console.error(
        `Unable to capture Razorpay payment ${razorpayPaymentId}`,
        error
      );

      payment = await razorpay.payments
        .fetch(razorpayPaymentId)
        .catch(() => payment);
    }
  }

  if (payment.status !== "captured") {
    throw new AppError(
      "This payment has not been captured yet. Please try again or contact support.",
      409
    );
  }

  return payment;
};


export const confirmOrderPayment = async (params: {
  orderId: number;
  razorpayPaymentId: string;
  razorpaySignature?: string | null;
  enforceExpiry: boolean;
}) => {
  const confirmed = await confirmOrderPaymentTx(params);

  await refundCancelledBeforeCapture(
    confirmed.id,
    params.razorpayPaymentId
  );

  return confirmed;
};

/**
 * Anything cancelled while the order was unpaid was charged anyway (the
 * Razorpay amount is fixed at creation). Give it back as soon as the
 * payment is confirmed. Item-level cancellation of unpaid online orders
 * is refused, so this only catches races and legacy orders.
 */
async function refundCancelledBeforeCapture(
  orderId: number,
  razorpayPaymentId: string
) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { cancelledAmount: true, refundedAmount: true },
  });

  if (order.cancelledAmount.lte(order.refundedAmount)) {
    return;
  }

  try {
    await issueRefundForOrder(
      orderId,
      `post-capture:${razorpayPaymentId}`,
      "Items cancelled before the payment was captured"
    );
  } catch (error) {
    // The refund worker re-issues whatever is still owed.
    logError("refund.post_capture_failed", error, {
      orderId,
      alert: true,
    });
  }
}

const confirmOrderPaymentTx = async (params: {
  orderId: number;
  razorpayPaymentId: string;
  razorpaySignature?: string | null;
  enforceExpiry: boolean;
}) => {
  const {
    orderId,
    razorpayPaymentId,
    razorpaySignature,
    enforceExpiry,
  } = params;

  return withTransactionRetry(
    () =>
      prisma.$transaction(
        async (tx) => {
          const currentOrder =
            await tx.order.findUnique({
              where: {
                id: orderId,
              },

              include: {
                items: true,
              },
            });

          if (!currentOrder) {
            throw new AppError(
              "Order not found",
              404
            );
          }


          if (
            currentOrder.paymentStatus ===
            "PAID"
          ) {
            return currentOrder;
          }

          if (
            currentOrder.status !==
              "PENDING" ||
            currentOrder.paymentStatus !==
              "PENDING"
          ) {
            throw new AppError(
              "Order can no longer be confirmed",
              409
            );
          }

          if (
            enforceExpiry &&
            currentOrder.expiresAt &&
            currentOrder.expiresAt <=
              new Date()
          ) {
            throw new AppError(
              "This payment session has expired",
              409
            );
          }

          await removePurchasedFromCart(
            tx,
            currentOrder.userId,
            currentOrder.items
          );

          return tx.order.update({
            where: {
              id: currentOrder.id,
            },

            data: {
              paymentStatus: "PAID",

              status: "CONFIRMED",

              razorpayPaymentId,

              ...(razorpaySignature
                ? {
                    razorpaySignature,
                  }
                : {}),
            },

            include: {
              items: true,
            },
          });
        },
        {
          isolationLevel:
            "Serializable",

          maxWait: 5000,

          timeout: 10000,
        }
      )
  );
};


export const verifyPayment = async (
  userId: number,
  razorpay_order_id: string,
  razorpay_payment_id: string,
  razorpay_signature: string
) => {
  const order =
    await prisma.order.findFirst({
      where: {
        razorpayOrderId:
          razorpay_order_id,

        userId,
      },

      include: {
        items: true,
      },
    });

  if (!order) {
    throw new AppError(
      "Order not found",
      404
    );
  }


  if (
    order.paymentStatus ===
    "PAID"
  ) {
    return order;
  }

  if (
    order.status !== "PENDING" ||
    order.paymentStatus !== "PENDING"
  ) {
    throw new AppError(
      "This order can no longer be paid",
      409
    );
  }

  if (
    order.expiresAt &&
    order.expiresAt <= new Date()
  ) {
    throw new AppError(
      "This payment session has expired",
      409
    );
  }


  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        process.env
          .RAZORPAY_KEY_SECRET!
      )
      .update(
        `${razorpay_order_id}|${razorpay_payment_id}`
      )
      .digest("hex");

  const expectedBuffer =
    Buffer.from(
      expectedSignature
    );

  const receivedBuffer =
    Buffer.from(
      razorpay_signature
    );

  if (
    expectedBuffer.length !==
      receivedBuffer.length ||
    !crypto.timingSafeEqual(
      expectedBuffer,
      receivedBuffer
    )
  ) {
    throw new AppError(
      "Payment verification failed",
      400
    );
  }

  await ensurePaymentCaptured(
    razorpay_order_id,
    razorpay_payment_id,
    toPaise(order.total)
  );

  return confirmOrderPayment({
    orderId: order.id,

    razorpayPaymentId:
      razorpay_payment_id,

    razorpaySignature:
      razorpay_signature,

    enforceExpiry: true,
  });
};
