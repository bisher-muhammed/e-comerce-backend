import Razorpay from "razorpay";
import crypto from "crypto";

import prisma from "../../config/prisma";

import AppError from "../../errors/AppError";

import {
  Prisma,
  CouponDiscountType,
} from "../../../generated/prisma/client";

import {
  withTransactionRetry,
  isUniqueConstraintOn,
} from "../../utils/transaction-retry.util";

// ============================================================
// RAZORPAY
// ============================================================

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const ONLINE_PAYMENT_WINDOW_MS =
  15 * 60 * 1000;

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
          product: true,
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

function getTodayStart(): Date {
  const now = new Date();

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
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
  subtotal: number
): number {
  const minimumOrderAmount =
    Number(coupon.minimumOrderAmount);

  const discountValue =
    Number(coupon.discountValue);

  const maximumDiscountAmount =
    coupon.maximumDiscountAmount !== null
      ? Number(coupon.maximumDiscountAmount)
      : null;

  if (subtotal < minimumOrderAmount) {
    throw new AppError(
      `Minimum order amount is ₹${minimumOrderAmount.toFixed(
        2
      )}`,
      400
    );
  }

  let discountAmount: number;

  if (
    coupon.discountType ===
    CouponDiscountType.PERCENTAGE
  ) {
    discountAmount =
      (subtotal * discountValue) / 100;

    if (
      maximumDiscountAmount !== null
    ) {
      discountAmount = Math.min(
        discountAmount,
        maximumDiscountAmount
      );
    }
  } else {
    discountAmount = Math.min(
      discountValue,
      subtotal
    );
  }


  discountAmount = Math.min(
    discountAmount,
    subtotal
  );

  return Number(
    discountAmount.toFixed(2)
  );
}


async function getCheckoutCoupon(
  tx: TransactionClient,
  userId: number,
  couponCode: string | undefined,
  subtotal: number
): Promise<{
  couponCode: string | null;
  couponDiscount: number;
  couponClaimId: number | null;
}> {
  /*
   * No coupon was selected.
   */
  if (!couponCode) {
    return {
      couponCode: null,
      couponDiscount: 0,
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
      },
    });

  if (!coupon) {
    throw new AppError(
      "Coupon not found",
      404
    );
  }

  const today = getTodayStart();

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

  const couponDiscount =
    calculateCouponDiscount(
      coupon,
      subtotal
    );

  return {
    couponCode: coupon.code,
    couponDiscount,
    couponClaimId: claim.id,
  };
}



async function getCartForCheckout(
  tx: TransactionClient,
  cartId: number
) {
  const cart =
    await tx.cart.findUniqueOrThrow({
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

  return cart;
}

function buildOrderItemsData(
  items: Array<{
    productVariantId: number;
    quantity: number;
    productVariant: {
      price: any;
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
  }>
) {
  return items.map((item) => ({
    productVariantId:
      item.productVariantId,

    productName:
      item.productVariant.productColor
        .product.name,

    colorName:
      item.productVariant.productColor
        .color.name,

    sizeName:
      item.productVariant.size.name,

    price:
      item.productVariant.price,

    quantity: item.quantity,

    remainingQuantity:
      item.quantity,

    cancelledQuantity: 0,

    returnedQuantity: 0,
  }));
}

async function reserveStockOrThrow(
  tx: Pick<
    TransactionClient,
    "productVariant"
  >,
  productVariantId: number,
  quantity: number,
  productName: string
) {
  const result =
    await tx.productVariant.updateMany({
      where: {
        id: productVariantId,
        stock: {
          gte: quantity,
        },
      },
      data: {
        stock: {
          decrement: quantity,
        },
      },
    });

  if (result.count !== 1) {
    throw new AppError(
      `${productName} no longer has enough stock`,
      409
    );
  }
}

async function releaseStock(
  tx: Pick<
    TransactionClient,
    "productVariant"
  >,
  productVariantId: number,
  quantity: number
) {
  await tx.productVariant.update({
    where: {
      id: productVariantId,
    },
    data: {
      stock: {
        increment: quantity,
      },
    },
  });
}

function calculateSubtotal(
  items: Array<{
    quantity: number;
    productVariant: {
      price: any;
    };
  }>
): number {
  const subtotal = items.reduce(
    (sum, item) =>
      sum +
      Number(item.productVariant.price) *
        item.quantity,
    0
  );

  return Number(subtotal.toFixed(2));
}

function createShippingSnapshot(
  address: {
    firstName: string;
    lastName: string | null;
    phone: string;
    addressLine1: string;
    addressLine2: string | null;
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

// ============================================================
// IDEMPOTENCY
// ============================================================

async function findOrderByIdempotencyKey(
  client:
    | TransactionClient
    | typeof prisma,
  idempotencyKey: string,
  userId: number
) {
  const existing =
    await client.order.findFirst({
      where: {
        idempotencyKey,
      },
      include: {
        items: true,
      },
    });

  if (!existing) {
    return null;
  }

  if (existing.userId !== userId) {
    /*
     * Never leak another user's order.
     */
    throw new AppError(
      "Invalid request",
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
  }
) {
  const {
    userId,
    contactEmail,
    contactPhone,
    shippingSnapshot,
    idempotencyKey,
    couponCode,
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
    /*
     * Another request using the same
     * idempotency key may already have
     * consumed the cart.
     */
    const dup =
      await findOrderByIdempotencyKey(
        tx,
        idempotencyKey,
        userId
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
    calculateSubtotal(cart.items);


  const coupon =
    await getCheckoutCoupon(
      tx,
      userId,
      couponCode,
      subtotal
    );

  const total = Number(
    (
      subtotal -
      coupon.couponDiscount
    ).toFixed(2)
  );

  /*
   * Reserve stock.
   */
  for (const item of cart.items) {
    await reserveStockOrThrow(
      tx,
      item.productVariantId,
      item.quantity,
      item.productVariant.productColor
        .product.name
    );
  }


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
              cart.items
            ),
        },
      },

      include: {
        items: true,
      },
    });


  if (coupon.couponClaimId !== null) {
    await tx.couponClaim.update({
      where: {
        id: coupon.couponClaimId,
      },
      data: {
        usedAt: new Date(),
        orderId: order.id,
      },
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
  }
) {
  const {
    userId,
    contactEmail,
    contactPhone,
    shippingSnapshot,
    idempotencyKey,
    couponCode,
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
        userId
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
    calculateSubtotal(cart.items);


  const coupon =
    await getCheckoutCoupon(
      tx,
      userId,
      couponCode,
      subtotal
    );


  const total = Number(
    (
      subtotal -
      coupon.couponDiscount
    ).toFixed(2)
  );

  /*
   * Reserve stock.
   */
  for (const item of cart.items) {
    await reserveStockOrThrow(
      tx,
      item.productVariantId,
      item.quantity,
      item.productVariant.productColor
        .product.name
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
              cart.items
            ),
        },
      },

      include: {
        items: true,
      },
    });


  if (coupon.couponClaimId !== null) {
    await tx.couponClaim.update({
      where: {
        id: coupon.couponClaimId,
      },
      data: {
        usedAt: new Date(),
        orderId: order.id,
      },
    });
  }


  await tx.cartItem.deleteMany({
    where: {
      cartId: cart.id,
    },
  });

  return order;
}


function buildOnlineResponse(
  order: {
    razorpayOrderId: string | null;
    total: any;
  }
) {
  if (!order.razorpayOrderId) {
    throw new AppError(
      "Payment initialization did not complete previously. Please try again.",
      409
    );
  }

  return {
    razorpay: {
      orderId:
        order.razorpayOrderId,

      amount: Math.round(
        Number(order.total) * 100
      ),

      currency: "INR",

      keyId:
        process.env.RAZORPAY_KEY_ID!,
    },
  };
}


async function runOnlineCheckout(
  params: {
    userId: number;
    contactEmail: string;
    contactPhone: string;
    shippingSnapshot: ShippingSnapshot;
    idempotencyKey: string;
    couponCode?: string;
  }
) {
  const {
    userId,
    contactEmail,
    contactPhone,
    shippingSnapshot,
    idempotencyKey,
    couponCode,
  } = params;

  const alreadyProcessed =
    await findOrderByIdempotencyKey(
      prisma,
      idempotencyKey,
      userId
    );

  if (alreadyProcessed) {
    return {
      order: alreadyProcessed,

      mode: "ONLINE" as const,

      ...buildOnlineResponse(
        alreadyProcessed
      ),
    };
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
          userId
        );

      if (dup) {
        return {
          order: dup,
          mode: "ONLINE" as const,
          ...buildOnlineResponse(
            dup
          ),
        };
      }
    }

    throw error;
  }


  if (pendingOrder.razorpayOrderId) {
    return {
      order: pendingOrder,

      mode: "ONLINE" as const,

      ...buildOnlineResponse(
        pendingOrder
      ),
    };
  }


  let razorpayOrder;

  try {
    razorpayOrder =
      await razorpay.orders.create({

        amount: Math.round(
          Number(pendingOrder.total) *
            100
        ),

        currency: "INR",

        receipt: `order_${pendingOrder.id}`,
      });
  } catch (error) {

    await withTransactionRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            const order =
              await tx.order.findUnique({
                where: {
                  id: pendingOrder.id,
                },

                include: {
                  items: true,
                },
              });

            if (!order) {
              return;
            }

            if (
              order.status !==
                "PENDING" ||
              order.paymentStatus !==
                "PENDING"
            ) {
              return;
            }

            for (const item of order.items) {
              await releaseStock(
                tx,
                item.productVariantId,
                item.quantity
              );
            }

            await tx.order.update({
              where: {
                id: order.id,
              },

              data: {
                status: "CANCELLED",
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

    throw new AppError(
      "Unable to initialize payment. Please try again.",
      502
    );
  }

  /*
   * Attach the Razorpay order ID.
   */
  const order =
    await prisma.order.update({
      where: {
        id: pendingOrder.id,
      },

      data: {
        razorpayOrderId:
          razorpayOrder.id,
      },
    });

  return {
    order,

    mode: "ONLINE" as const,

    razorpay: {
      orderId:
        razorpayOrder.id,

      amount:
        Number(
          razorpayOrder.amount
        ),

      currency:
        razorpayOrder.currency,

      keyId:
        process.env.RAZORPAY_KEY_ID!,
    },
  };
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
  couponCode?: string
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
            userId
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
  });
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



  return withTransactionRetry(
    () =>
      prisma.$transaction(
        async (tx) => {
          const currentOrder =
            await tx.order.findUnique({
              where: {
                id: order.id,
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
            currentOrder.expiresAt &&
            currentOrder.expiresAt <=
              new Date()
          ) {
            throw new AppError(
              "This payment session has expired",
              409
            );
          }
          return tx.order.update({
            where: {
              id: currentOrder.id,
            },

            data: {
              paymentStatus: "PAID",

              status: "CONFIRMED",

              razorpayPaymentId:
                razorpay_payment_id,

              razorpaySignature:
                razorpay_signature,
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
