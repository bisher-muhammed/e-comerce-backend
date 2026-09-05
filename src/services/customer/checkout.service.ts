import Razorpay from "razorpay";
import crypto from "crypto";
import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { withTransactionRetry, isUniqueConstraintOn } from "../../utils/transaction-retry.util";


const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const ONLINE_PAYMENT_WINDOW_MS = 15 * 60 * 1000;

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

type ShippingSnapshot = ReturnType<typeof createShippingSnapshot>;

/* ------------------------------------------------------------------ */
/* Shared helpers (unchanged logic, tightened types)                  */
/* ------------------------------------------------------------------ */

async function getCartForCheckout(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], cartId: number) {
  const cart = await tx.cart.findUniqueOrThrow({
    where: { id: cartId },
    include: { items: { include: CART_ITEM_INCLUDE } },
  });

  // Deterministic ordering by productVariantId prevents a class of
  // deadlocks: if two different orders touch the same two variants but
  // reserve stock in opposite order, they can deadlock against each
  // other under row-level locking. Always locking/reserving in the
  // same order across all transactions eliminates that.
  cart.items.sort((a, b) => a.productVariantId - b.productVariantId);

  return cart;
}

function buildOrderItemsData(
  items: Array<{
    productVariantId: number;
    quantity: number;
    productVariant: {
      price: any;
      size: { name: string };
      productColor: {
        color: { name: string };
        product: { name: string };
      };
    };
  }>
) {
  return items.map((item) => ({
    productVariantId: item.productVariantId,
    productName: item.productVariant.productColor.product.name,
    colorName: item.productVariant.productColor.color.name,
    sizeName: item.productVariant.size.name,
    price: item.productVariant.price,
    quantity: item.quantity,
    remainingQuantity: item.quantity,

    cancelledQuantity: 0,
    returnedQuantity: 0,
  }));
}


async function reserveStockOrThrow(
  tx: Pick<Parameters<Parameters<typeof prisma.$transaction>[0]>[0], "productVariant">,
  productVariantId: number,
  quantity: number,
  productName: string
) {
  const result = await tx.productVariant.updateMany({
    where: { id: productVariantId, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });

  if (result.count !== 1) {
    throw new AppError(`${productName} no longer has enough stock`, 409);
  }
}

async function releaseStock(
  tx: Pick<Parameters<Parameters<typeof prisma.$transaction>[0]>[0], "productVariant">,
  productVariantId: number,
  quantity: number
) {
  await tx.productVariant.update({
    where: { id: productVariantId },
    data: { stock: { increment: quantity } },
  });
}

function calculateSubtotal(
  items: Array<{ quantity: number; productVariant: { price: any } }>
) {
  return items.reduce(
    (sum, item) => sum + Number(item.productVariant.price) * item.quantity,
    0
  );
}

function createShippingSnapshot(address: {
  firstName: string;
  lastName: string | null;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}) {
  return {
    shippingFirstName: address.firstName,
    shippingLastName: address.lastName,
    shippingPhone: address.phone,
    shippingLine1: address.addressLine1,
    shippingLine2: address.addressLine2,
    shippingCity: address.city,
    shippingState: address.state,
    shippingPostalCode: address.postalCode,
    shippingCountry: address.country,
  };
}

/* ------------------------------------------------------------------ */
/* Idempotency                                                        */
/* ------------------------------------------------------------------ */

async function findOrderByIdempotencyKey(
  client: Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma,
  idempotencyKey: string,
  userId: number
) {
  const existing = await client.order.findFirst({
    where: { idempotencyKey },
    include: { items: true },
  });

  if (!existing) return null;

  if (existing.userId !== userId) {
    // Someone is replaying/guessing an idempotency key that isn't
    // theirs. Don't leak the order — just reject.
    throw new AppError("Invalid request", 409);
  }

  return existing;
}

/* ------------------------------------------------------------------ */
/* COD                                                                 */
/* ------------------------------------------------------------------ */

async function runCodCheckout(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  params: {
    userId: number;
    contactEmail: string;
    contactPhone: string;
    shippingSnapshot: ShippingSnapshot;
    idempotencyKey: string;
  }
) {
  const { userId, contactEmail, contactPhone, shippingSnapshot, idempotencyKey } = params;

  /*
   * Lock the user's cart row. Two concurrent checkout requests from the
   * same user (two tabs, or a double-click that both reached the
   * server) cannot proceed through this section simultaneously.
   */
  const lockedCart = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "Cart" WHERE "userId" = ${userId} FOR UPDATE
  `;

  if (lockedCart.length === 0) {
    throw new AppError("Your cart is empty", 400);
  }

  const cart = await getCartForCheckout(tx, lockedCart[0].id);

  if (cart.items.length === 0) {
    /*
     * The cart is empty because a concurrent request (same
     * idempotency key, e.g. a duplicate click that was blocked on the
     * lock above) already consumed it and created the order. Don't
     * tell the user "cart is empty" — hand back the order that was
     * actually created.
     */
    const dup = await findOrderByIdempotencyKey(tx, idempotencyKey, userId);
    if (dup) return dup;

    throw new AppError("Your cart is empty", 400);
  }

  const subtotal = calculateSubtotal(cart.items);

  for (const item of cart.items) {
    await reserveStockOrThrow(
      tx,
      item.productVariantId,
      item.quantity,
      item.productVariant.productColor.product.name
    );
  }

  // NOTE: if this create() throws P2002 on idempotencyKey (two
  // transactions racing with the same key, both past the lock somehow
  // — e.g. retried after a connection blip), we deliberately let it
  // propagate. That aborts this whole transaction, which automatically
  // rolls back the stock decrements above. The caller catches P2002
  // and re-fetches the winning order.
  const order = await tx.order.create({
    data: {
      userId,
      contactEmail,
      contactPhone,
      status: "CONFIRMED",
      paymentMethod: "COD",
      paymentStatus: "PENDING",
      idempotencyKey: idempotencyKey,
      ...shippingSnapshot,
      subtotal,
      total: subtotal,
      items: { create: buildOrderItemsData(cart.items) },
    },
    include: { items: true },
  });

  await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

  return order;
}

/* ------------------------------------------------------------------ */
/* ONLINE                                                              */
/* ------------------------------------------------------------------ */

async function runOnlinePendingOrderCreation(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  params: {
    userId: number;
    contactEmail: string;
    contactPhone: string;
    shippingSnapshot: ShippingSnapshot;
    idempotencyKey: string;
  }
) {
  const { userId, contactEmail, contactPhone, shippingSnapshot, idempotencyKey } = params;

  const lockedCart = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "Cart" WHERE "userId" = ${userId} FOR UPDATE
  `;

  if (lockedCart.length === 0) {
    throw new AppError("Your cart is empty", 400);
  }

  const cart = await getCartForCheckout(tx, lockedCart[0].id);

  if (cart.items.length === 0) {
    const dup = await findOrderByIdempotencyKey(tx, idempotencyKey, userId);
    if (dup) return dup;

    throw new AppError("Your cart is empty", 400);
  }

  const subtotal = calculateSubtotal(cart.items);

  for (const item of cart.items) {
    await reserveStockOrThrow(
      tx,
      item.productVariantId,
      item.quantity,
      item.productVariant.productColor.product.name
    );
  }

  const expiresAt = new Date(Date.now() + ONLINE_PAYMENT_WINDOW_MS);

  const order = await tx.order.create({
    data: {
      userId,
      contactEmail,
      contactPhone,
      status: "PENDING",
      paymentMethod: "ONLINE",
      paymentStatus: "PENDING",
      idempotencyKey: idempotencyKey,
      ...shippingSnapshot,
      subtotal,
      total: subtotal,
      expiresAt,
      items: { create: buildOrderItemsData(cart.items) },
    },
    include: { items: true },
  });

  await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

  return order;
}

function buildOnlineResponse(order: { razorpayOrderId: string | null; total: any }) {
  if (!order.razorpayOrderId) {
    /*
     * The local order exists (this is an idempotent replay) but no
     * Razorpay order was ever attached to it. That means a previous
     * attempt crashed between committing the DB row and calling the
     * Razorpay API. We do NOT silently create a second Razorpay order
     * here — that would defeat the point of idempotency. Surface a
     * clear error and let the caller retry checkout from scratch
     * (which will hit this same order via the idempotency key and can
     * be extended to attach a Razorpay order on retry if you want that
     * behavior instead of an error).
     */
    throw new AppError(
      "Payment initialization did not complete previously. Please try again.",
      409
    );
  }

  return {
    razorpay: {
      orderId: order.razorpayOrderId,
      amount: Math.round(Number(order.total) * 100),
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID!,
    },
  };
}

async function runOnlineCheckout(params: {
  userId: number;
  contactEmail: string;
  contactPhone: string;
  shippingSnapshot: ShippingSnapshot;
  idempotencyKey: string;
}) {
  const { userId, contactEmail, contactPhone, shippingSnapshot, idempotencyKey } = params;

  /*
   * Fast path: this exact idempotency key already produced a fully
   * formed pending order with an attached Razorpay order. Return it
   * without touching the cart at all. This is the common case for a
   * duplicate click that arrives while the first request is still in
   * flight or already succeeded.
   */
  const alreadyProcessed = await findOrderByIdempotencyKey(prisma, idempotencyKey, userId);
  if (alreadyProcessed) {
    return {
      order: alreadyProcessed,
      mode: "ONLINE" as const,
      ...buildOnlineResponse(alreadyProcessed),
    };
  }

  let pendingOrder;

  try {
    pendingOrder = await withTransactionRetry(() =>
      prisma.$transaction(
        (tx) =>
          runOnlinePendingOrderCreation(tx, {
            userId,
            contactEmail,
            contactPhone,
            shippingSnapshot,
            idempotencyKey,
          }),
        { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 }
      )
    );
  } catch (error) {
    if (isUniqueConstraintOn(error, "idempotencyKey")) {
      const dup = await findOrderByIdempotencyKey(prisma, idempotencyKey, userId);
      if (dup) {
        return { order: dup, mode: "ONLINE" as const, ...buildOnlineResponse(dup) };
      }
    }
    throw error;
  }

  // If findOrderByIdempotencyKey inside the tx already returned an
  // existing order (the "cart already consumed" branch), it may
  // already have a razorpayOrderId — in which case we're done.
  if (pendingOrder.razorpayOrderId) {
    return { order: pendingOrder, mode: "ONLINE" as const, ...buildOnlineResponse(pendingOrder) };
  }

  /*
   * Razorpay API call happens OUTSIDE the DB transaction — never hold
   * a DB transaction open across a network call to a third party.
   */
  let razorpayOrder;

  try {
    razorpayOrder = await razorpay.orders.create({
      amount: Math.round(Number(pendingOrder.total) * 100),
      currency: "INR",
      receipt: `order_${pendingOrder.id}`,
    });
  } catch (error) {
    await withTransactionRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: pendingOrder.id },
            include: { items: true },
          });

          if (!order) return;

          if (order.status !== "PENDING" || order.paymentStatus !== "PENDING") {
            return;
          }

          for (const item of order.items) {
            await releaseStock(tx, item.productVariantId, item.quantity);
          }

          await tx.order.update({
            where: { id: order.id },
            data: { status: "CANCELLED" },
          });
        },
        { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 }
      )
    );

    throw new AppError("Unable to initialize payment. Please try again.", 502);
  }

  const order = await prisma.order.update({
    where: { id: pendingOrder.id },
    data: { razorpayOrderId: razorpayOrder.id },
  });

  return {
    order,
    mode: "ONLINE" as const,
    razorpay: {
      orderId: razorpayOrder.id,
      amount: Number(razorpayOrder.amount),
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID!,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export const createCheckout = async (
  userId: number,
  addressId: number,
  contactEmail: string,
  contactPhone: string,
  paymentMethod: "COD" | "ONLINE",
  idempotencyKey: string
) => {
  const address = await prisma.address.findFirst({ where: { id: addressId, userId } });

  if (!address) {
    throw new AppError("Address not found", 404);
  }

  const shippingSnapshot = createShippingSnapshot(address);

  if (paymentMethod === "COD") {
    let order;

    try {
      order = await withTransactionRetry(() =>
        prisma.$transaction(
          (tx) =>
            runCodCheckout(tx, {
              userId,
              contactEmail,
              contactPhone,
              shippingSnapshot,
              idempotencyKey,
            }),
          { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 }
        )
      );
    } catch (error) {
      if (isUniqueConstraintOn(error, "idempotencyKey")) {
        const dup = await findOrderByIdempotencyKey(prisma, idempotencyKey, userId);
        if (dup) return { order: dup, mode: "COD" as const };
      }
      throw error;
    }

    return { order, mode: "COD" as const };
  }

  return runOnlineCheckout({
    userId,
    contactEmail,
    contactPhone,
    shippingSnapshot,
    idempotencyKey,
  });
};

/*
 * ======================================================
 * VERIFY PAYMENT
 * ======================================================
 * Stock was already reserved during createCheckout(). This function
 * MUST NOT decrement stock.
 */

export const verifyPayment = async (
  userId: number,
  razorpay_order_id: string,
  razorpay_payment_id: string,
  razorpay_signature: string
) => {
  const order = await prisma.order.findFirst({
    where: { razorpayOrderId: razorpay_order_id, userId },
    include: { items: true },
  });

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  if (order.paymentStatus === "PAID") {
    return order; // idempotent replay of a successful verification
  }

  if (order.status !== "PENDING" || order.paymentStatus !== "PENDING") {
    throw new AppError("This order can no longer be paid", 409);
  }

  if (order.expiresAt && order.expiresAt <= new Date()) {
    throw new AppError("This payment session has expired", 409);
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(razorpay_signature);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new AppError("Payment verification failed", 400);
  }

  /*
   * This can race against the expired-order cleanup job (checkout-
   * cleanup.service.ts) if the user submits payment right as the
   * window closes. Serializable isolation + retry means one of the
   * two transactions will lose and get a P2034, retry, re-read the
   * now-updated row, and correctly hit one of the guard checks above.
   */
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const currentOrder = await tx.order.findUnique({
          where: { id: order.id },
          include: { items: true },
        });

        if (!currentOrder) {
          throw new AppError("Order not found", 404);
        }

        if (currentOrder.paymentStatus === "PAID") {
          return currentOrder;
        }

        if (currentOrder.status !== "PENDING" || currentOrder.paymentStatus !== "PENDING") {
          throw new AppError("Order can no longer be confirmed", 409);
        }

        if (currentOrder.expiresAt && currentOrder.expiresAt <= new Date()) {
          throw new AppError("This payment session has expired", 409);
        }

        return tx.order.update({
          where: { id: currentOrder.id },
          data: {
            paymentStatus: "PAID",
            status: "CONFIRMED",
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
          },
        });
      },
      { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 }
    )
  );
};
