import crypto from "crypto";
import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { OrderStatus } from "../../../generated/prisma/enums";
import { Prisma } from "../../../generated/prisma/client";

// ============================================================
// HELPERS
// ============================================================

function isIdempotencyConflict(err: unknown): boolean {
    return (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
    );
}

// ============================================================
// ORDER SELECT
// ============================================================

const orderDetailsSelect = {
    id: true,
    status: true,
    paymentMethod: true,
    paymentStatus: true,

    // Contact snapshot
    contactEmail: true,
    contactPhone: true,

    // Shipping snapshot
    shippingFirstName: true,
    shippingLastName: true,
    shippingPhone: true,
    shippingLine1: true,
    shippingLine2: true,
    shippingCity: true,
    shippingState: true,
    shippingPostalCode: true,
    shippingCountry: true,

    // Financial values
    subtotal: true,
    total: true,
    cancelledAmount: true,
    refundedAmount: true,

    cancellationReason: true,

    // Payment window
    expiresAt: true,

    createdAt: true,
    updatedAt: true,

    items: {
        select: {
            id: true,
            productVariantId: true,
            productName: true,
            colorName: true,
            sizeName: true,
            price: true,

            // Quantity tracking
            quantity: true,
            remainingQuantity: true,
            cancelledQuantity: true,
            returnedQuantity: true,

            createdAt: true,

            productVariant: {
                select: {
                    productColor: {
                        select: {
                            images: {
                                where: { isPrimary: true },
                                select: {
                                    url: true,
                                    altText: true,
                                },
                                take: 1,
                            },
                        },
                    },
                },
            },
        },
    },
} as const;

// ============================================================
// GET ORDER BY ID
// ============================================================

export async function getOrderByIdForUser(
    orderId: number,
    userId: number
) {
    const order = await prisma.order.findFirst({
        where: {
            id: orderId,
            userId,
        },
        select: orderDetailsSelect,
    });

    if (!order) {
        throw new AppError("Order not found", 404);
    }

    return order;
}

// ============================================================
// LIST ORDERS — search + date filter
// ============================================================

export async function listOrdersForUser(
    userId: number,
    page: number,
    limit: number,
    options?: {
        status?: OrderStatus;
        search?: string;
        dateField?: "createdAt" | "updatedAt";
        startDate?: Date;
        endDate?: Date;
    }
) {
    const {
        status,
        search,
        dateField = "createdAt",
        startDate,
        endDate,
    } = options ?? {};

    const dateFilter =
        startDate || endDate
            ? {
                  [dateField]: {
                      ...(startDate && { gte: startDate }),
                      ...(endDate && { lte: endDate }),
                  },
              }
            : {};

    const numericSearch =
        search && /^\d+$/.test(search)
            ? Number(search)
            : undefined;

    const searchFilter = search
        ? {
              OR: [
                  ...(numericSearch !== undefined
                      ? [{ id: numericSearch }]
                      : []),

                  {
                      items: {
                          some: {
                              productName: {
                                  contains: search,
                                  mode: "insensitive" as const,
                              },
                          },
                      },
                  },
              ],
          }
        : {};

    const where = {
        userId,
        ...(status && { status }),
        ...dateFilter,
        ...searchFilter,
    };

    const [orders, total] = await prisma.$transaction([
        prisma.order.findMany({
            where,
            select: {
                id: true,
                status: true,
                paymentMethod: true,
                paymentStatus: true,
                subtotal: true,
                total: true,
                expiresAt: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: {
                        items: true,
                    },
                },
            },
            orderBy: {
                createdAt: "desc",
            },
            skip: (page - 1) * limit,
            take: limit,
        }),

        prisma.order.count({
            where,
        }),
    ]);

    return {
        orders,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// ============================================================
// ORDER-LEVEL CANCEL
//
// Cancels every remaining quantity in the order.
//
// Financial effect:
//
// cancelledAmount += value of all remaining quantities
// subtotal        -= value of all remaining quantities
// total           -= value of all remaining quantities
//
// Inventory effect:
//
// productVariant.stock += cancelled quantity
//
// ============================================================

export async function cancelOrder(
    orderId: number,
    userId: number,
    idempotencyKey: string,
    reason?: string
) {
    const order = await prisma.order.findFirst({
        where: {
            id: orderId,
            userId,
        },
        select: {
            id: true,
            status: true,
            items: {
                select: {
                    id: true,
                    price: true,
                    remainingQuantity: true,
                    productVariantId: true,
                },
            },
        },
    });

    if (!order) {
        throw new AppError("Order not found", 404);
    }

    // --------------------------------------------------------
    // Already cancelled
    // --------------------------------------------------------

    if (order.status === "CANCELLED") {
        return getOrderByIdForUser(orderId, userId);
    }

    // --------------------------------------------------------
    // Cancellation allowed only for pending/confirmed
    // --------------------------------------------------------

    if (
        order.status !== "PENDING" &&
        order.status !== "CONFIRMED"
    ) {
        throw new AppError(
            `Only pending or confirmed orders can be cancelled. Current status: ${order.status}`,
            400
        );
    }

    const activeItems = order.items.filter(
        (item) => item.remainingQuantity > 0
    );

    if (activeItems.length === 0) {
        throw new AppError(
            "Order has no remaining quantity to cancel",
            409
        );
    }

    try {
        await prisma.$transaction(async (tx) => {
            let cancellationAmount = new Prisma.Decimal(0);

            // ------------------------------------------------
            // Cancel every remaining quantity
            // ------------------------------------------------

            for (const item of activeItems) {
                const quantity = item.remainingQuantity;

                // Calculate value from immutable order-item price
                const itemCancellationAmount =
                    item.price.mul(quantity);

                cancellationAmount =
                    cancellationAmount.add(
                        itemCancellationAmount
                    );

                // --------------------------------------------
                // Record cancellation action
                // --------------------------------------------

                await tx.orderItemAction.create({
                    data: {
                        orderItemId: item.id,
                        type: "CANCEL",
                        quantity,
                        reason,
                        idempotencyKey,
                    },
                });

                // --------------------------------------------
                // Update item atomically
                // --------------------------------------------

                const updated = await tx.orderItem.updateMany({
                    where: {
                        id: item.id,
                        remainingQuantity: {
                            gte: quantity,
                        },
                    },
                    data: {
                        remainingQuantity: {
                            decrement: quantity,
                        },
                        cancelledQuantity: {
                            increment: quantity,
                        },
                    },
                });

                if (updated.count === 0) {
                    throw new AppError(
                        `Failed to cancel item ${item.id} — quantity changed concurrently`,
                        409
                    );
                }

                // --------------------------------------------
                // Restock cancelled quantity
                // --------------------------------------------

                await tx.productVariant.update({
                    where: {
                        id: item.productVariantId,
                    },
                    data: {
                        stock: {
                            increment: quantity,
                        },
                    },
                });
            }

            // ------------------------------------------------
            // Update order financials
            // ------------------------------------------------

            await tx.order.update({
                where: {
                    id: orderId,
                },
                data: {
                    status: "CANCELLED",

                    cancellationReason: reason,

                    cancelledAmount: {
                        increment: cancellationAmount,
                    },

                    subtotal: {
                        decrement: cancellationAmount,
                    },

                    total: {
                        decrement: cancellationAmount,
                    },
                },
            });
        });
    } catch (err) {
        // Same idempotency key means this request was already
        // successfully processed.
        if (isIdempotencyConflict(err)) {
            const current = await prisma.order.findUnique({
                where: {
                    id: orderId,
                },
                select: {
                    status: true,
                },
            });

            if (current?.status === "CANCELLED") {
                return getOrderByIdForUser(orderId, userId);
            }
        }

        throw err;
    }

    return getOrderByIdForUser(orderId, userId);
}

// ============================================================
// ITEM MUTATION SELECT
// ============================================================

const orderItemMutationSelect = {
    id: true,
    remainingQuantity: true,
    cancelledQuantity: true,
    returnedQuantity: true,
    updatedAt: true,
} as const;

// ============================================================
// ITEM-LEVEL CANCEL
//
// Cancels a specific quantity from one order item.
//
// Example:
//
// price = 500
// quantity = 5
// cancel = 2
//
// cancellationAmount = 500 * 2 = 1000
//
// Order:
//
// cancelledAmount += 1000
// subtotal        -= 1000
// total           -= 1000
//
// Item:
//
// remainingQuantity -= 2
// cancelledQuantity += 2
//
// Product:
//
// stock += 2
//
// ============================================================

export async function cancelOrderItem(
    orderId: number,
    itemId: number,
    userId: number,
    quantity: number,
    idempotencyKey: string,
    reason?: string
) {
    const item = await prisma.orderItem.findFirst({
        where: {
            id: itemId,
            orderId,
            order: {
                userId,
            },
        },
        select: {
            id: true,
            price: true,
            remainingQuantity: true,
            productVariantId: true,

            order: {
                select: {
                    status: true,
                },
            },
        },
    });

    if (!item) {
        throw new AppError("Order item not found", 404);
    }

    // --------------------------------------------------------
    // Check order status
    // --------------------------------------------------------

    if (
        item.order.status !== "PENDING" &&
        item.order.status !== "CONFIRMED"
    ) {
        throw new AppError(
            `Items can only be cancelled while the order is PENDING or CONFIRMED. Current status: ${item.order.status}`,
            400
        );
    }

    // --------------------------------------------------------
    // Check remaining quantity
    // --------------------------------------------------------

    if (quantity > item.remainingQuantity) {
        throw new AppError(
            `Cannot cancel ${quantity} unit(s); only ${item.remainingQuantity} remain active`,
            409
        );
    }

    // --------------------------------------------------------
    // Calculate cancellation value
    //
    // IMPORTANT:
    // Use OrderItem.price, NOT ProductVariant.price.
    //
    // OrderItem.price is the historical price actually used
    // when this order was created.
    // --------------------------------------------------------

    const cancellationAmount = item.price.mul(quantity);

    try {
        return await prisma.$transaction(async (tx) => {
            // ------------------------------------------------
            // Record cancellation action
            // ------------------------------------------------

            await tx.orderItemAction.create({
                data: {
                    orderItemId: itemId,
                    type: "CANCEL",
                    quantity,
                    reason,
                    idempotencyKey,
                },
            });

            // ------------------------------------------------
            // Update item atomically
            // ------------------------------------------------

            const updated = await tx.orderItem.updateMany({
                where: {
                    id: itemId,
                    orderId,
                    remainingQuantity: {
                        gte: quantity,
                    },
                },
                data: {
                    remainingQuantity: {
                        decrement: quantity,
                    },
                    cancelledQuantity: {
                        increment: quantity,
                    },
                },
            });

            if (updated.count === 0) {
                throw new AppError(
                    `Cannot cancel ${quantity} unit(s); insufficient remaining quantity`,
                    409
                );
            }

            // ------------------------------------------------
            // Restock cancelled quantity
            // ------------------------------------------------

            await tx.productVariant.update({
                where: {
                    id: item.productVariantId,
                },
                data: {
                    stock: {
                        increment: quantity,
                    },
                },
            });

            // ------------------------------------------------
            // Update order financials
            // ------------------------------------------------

            await tx.order.update({
                where: {
                    id: orderId,
                },
                data: {
                    cancelledAmount: {
                        increment: cancellationAmount,
                    },

                    subtotal: {
                        decrement: cancellationAmount,
                    },

                    total: {
                        decrement: cancellationAmount,
                    },
                },
            });

            // ------------------------------------------------
            // Determine whether entire order is now cancelled
            // ------------------------------------------------

            const remainingActive = await tx.orderItem.count({
                where: {
                    orderId,
                    remainingQuantity: {
                        gt: 0,
                    },
                },
            });

            if (remainingActive === 0) {
                await tx.order.update({
                    where: {
                        id: orderId,
                    },
                    data: {
                        status: "CANCELLED",
                    },
                });
            }

            // ------------------------------------------------
            // Return only the item mutation result
            //
            // Existing frontend contract is preserved.
            // The frontend can refetch order details to obtain
            // the updated subtotal/total.
            // ------------------------------------------------

            return tx.orderItem.findUniqueOrThrow({
                where: {
                    id: itemId,
                },
                select: orderItemMutationSelect,
            });
        });
    } catch (err) {
        // ----------------------------------------------------
        // Idempotency
        // ----------------------------------------------------

        if (isIdempotencyConflict(err)) {
            return prisma.orderItem.findUniqueOrThrow({
                where: {
                    id: itemId,
                },
                select: orderItemMutationSelect,
            });
        }

        throw err;
    }
}

// ============================================================
// ITEM-LEVEL RETURN
//
// IMPORTANT:
//
// A customer return is NOT the same thing as a cancellation.
//
// Customer requests return:
//
// remainingQuantity -= quantity
// returnedQuantity  += quantity
//
// But:
//
// stock              -> unchanged
// subtotal           -> unchanged
// total              -> unchanged
// refundedAmount     -> unchanged
//
// Actual refund amount should be added to refundedAmount only
// when your refund process actually succeeds.
//
// Restocking should happen after admin inspection.
// ============================================================

export async function returnOrderItem(
    orderId: number,
    itemId: number,
    userId: number,
    quantity: number,
    reason: string,
    idempotencyKey: string
) {
    const item = await prisma.orderItem.findFirst({
        where: {
            id: itemId,
            orderId,
            order: {
                userId,
            },
        },
        select: {
            id: true,
            remainingQuantity: true,

            order: {
                select: {
                    status: true,
                },
            },
        },
    });

    if (!item) {
        throw new AppError("Order item not found", 404);
    }

    // --------------------------------------------------------
    // Only delivered orders can be returned
    // --------------------------------------------------------

    if (item.order.status !== "DELIVERED") {
        throw new AppError(
            "Only items on delivered orders can be returned",
            400
        );
    }

    // --------------------------------------------------------
    // Check returnable quantity
    // --------------------------------------------------------

    if (quantity > item.remainingQuantity) {
        throw new AppError(
            `Cannot return ${quantity} unit(s); only ${item.remainingQuantity} remain eligible`,
            409
        );
    }

    try {
        return await prisma.$transaction(async (tx) => {
            // ------------------------------------------------
            // Record return action
            // ------------------------------------------------

            await tx.orderItemAction.create({
                data: {
                    orderItemId: itemId,
                    type: "RETURN",
                    quantity,
                    reason,
                    idempotencyKey,
                },
            });

            // ------------------------------------------------
            // Update item atomically
            // ------------------------------------------------

            const updated = await tx.orderItem.updateMany({
                where: {
                    id: itemId,
                    orderId,
                    remainingQuantity: {
                        gte: quantity,
                    },
                },
                data: {
                    remainingQuantity: {
                        decrement: quantity,
                    },
                    returnedQuantity: {
                        increment: quantity,
                    },
                },
            });

            if (updated.count === 0) {
                throw new AppError(
                    `Cannot return ${quantity} unit(s); insufficient remaining quantity`,
                    409
                );
            }

            // ------------------------------------------------
            // No stock update here.
            //
            // Admin inspection determines whether the item
            // can be put back into sellable inventory.
            // ------------------------------------------------

            return tx.orderItem.findUniqueOrThrow({
                where: {
                    id: itemId,
                },
                select: orderItemMutationSelect,
            });
        });
    } catch (err) {
        if (isIdempotencyConflict(err)) {
            return prisma.orderItem.findUniqueOrThrow({
                where: {
                    id: itemId,
                },
                select: orderItemMutationSelect,
            });
        }

        throw err;
    }
}

// ============================================================
// VERIFY RAZORPAY PAYMENT
//
// Stock was already deducted when the order was created.
// Therefore payment verification does NOT touch stock.
//
// It only:
//
// paymentStatus = PAID
// status        = CONFIRMED
//
// ============================================================

export async function verifyPayment(
    orderId: number,
    userId: number,
    razorpayPaymentId: string,
    razorpaySignature: string
) {
    const order = await prisma.order.findFirst({
        where: {
            id: orderId,
            userId,
        },
    });

    if (!order) {
        throw new AppError("Order not found", 404);
    }

    // --------------------------------------------------------
    // Already paid
    // --------------------------------------------------------

    if (order.paymentStatus === "PAID") {
        return order;
    }

    // --------------------------------------------------------
    // Must be online payment
    // --------------------------------------------------------

    if (order.paymentMethod !== "ONLINE") {
        throw new AppError(
            "This order does not use online payment",
            400
        );
    }

    if (!order.razorpayOrderId) {
        throw new AppError(
            "Razorpay order ID is missing",
            400
        );
    }

    // --------------------------------------------------------
    // Razorpay secret
    // --------------------------------------------------------

    const secret = process.env.RAZORPAY_KEY_SECRET;

    if (!secret) {
        throw new AppError(
            "Payment configuration error",
            500
        );
    }

    // --------------------------------------------------------
    // Verify Razorpay signature
    // --------------------------------------------------------

    const generatedSignature = crypto
        .createHmac("sha256", secret)
        .update(
            `${order.razorpayOrderId}|${razorpayPaymentId}`
        )
        .digest("hex");

    const generatedBuffer = Buffer.from(
        generatedSignature,
        "utf8"
    );

    const receivedBuffer = Buffer.from(
        razorpaySignature,
        "utf8"
    );

    if (
        generatedBuffer.length !== receivedBuffer.length ||
        !crypto.timingSafeEqual(
            generatedBuffer,
            receivedBuffer
        )
    ) {
        throw new AppError(
            "Payment verification failed",
            400
        );
    }

    // --------------------------------------------------------
    // Update payment status atomically
    // --------------------------------------------------------

    const updatedOrder = await prisma.$transaction(
        async (tx) => {
            const currentOrder =
                await tx.order.findUnique({
                    where: {
                        id: orderId,
                    },
                    select: {
                        id: true,
                        paymentStatus: true,
                    },
                });

            if (!currentOrder) {
                throw new AppError(
                    "Order not found",
                    404
                );
            }

            // Another request already completed payment
            if (currentOrder.paymentStatus === "PAID") {
                return tx.order.findUnique({
                    where: {
                        id: orderId,
                    },
                });
            }

            return tx.order.update({
                where: {
                    id: orderId,
                },
                data: {
                    paymentStatus: "PAID",
                    status: "CONFIRMED",
                    razorpayPaymentId,
                    razorpaySignature,
                },
            });
        }
    );

    return updatedOrder;
}

