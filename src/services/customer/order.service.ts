import crypto from "crypto";
import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { Prisma } from "../../../generated/prisma/client";

type OrderStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "DELIVERED";

function isIdempotencyConflict(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// ============================================================
// ORDER SELECT
// ============================================================

const orderDetailsSelect = {
    id: true,
    status: true,
    paymentMethod: true,
    paymentStatus: true,

    shippingFirstName: true,
    shippingLastName: true,
    shippingPhone: true,
    shippingLine1: true,
    shippingLine2: true,
    shippingCity: true,
    shippingState: true,
    shippingPostalCode: true,
    shippingCountry: true,

    subtotal: true,
    total: true,

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
                                select: { url: true, altText: true },
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

export async function getOrderByIdForUser(orderId: number, userId: number) {
    const order = await prisma.order.findFirst({
        where: { id: orderId, userId },
        select: orderDetailsSelect,
    });

    if (!order) throw new AppError("Order not found", 404);

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
    const { status, search, dateField = "createdAt", startDate, endDate } = options ?? {};

    const dateFilter =
        startDate || endDate
            ? { [dateField]: { ...(startDate && { gte: startDate }), ...(endDate && { lte: endDate }) } }
            : {};

    const numericSearch = search && /^\d+$/.test(search) ? Number(search) : undefined;

    const searchFilter = search
        ? {
              OR: [
                  ...(numericSearch !== undefined ? [{ id: numericSearch }] : []),
                  { items: { some: { productName: { contains: search, mode: "insensitive" as const } } } },
              ],
          }
        : {};

    const where = { userId, ...(status && { status }), ...dateFilter, ...searchFilter };

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
                createdAt: true,
                updatedAt: true,
                _count: { select: { items: true } },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.order.count({ where }),
    ]);

    return { orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// ============================================================
// ORDER-LEVEL CANCEL — cancels + restocks every remaining item
// ============================================================

export async function cancelOrder(orderId: number, userId: number, idempotencyKey: string) {
    const order = await prisma.order.findFirst({
        where: { id: orderId, userId },
        select: {
            id: true,
            status: true,
            items: { select: { id: true, remainingQuantity: true, productVariantId: true } },
        },
    });

    if (!order) throw new AppError("Order not found", 404);

    if (order.status === "CANCELLED") {
        return getOrderByIdForUser(orderId, userId);
    }

    if (order.status !== "PENDING" && order.status !== "CONFIRMED") {
        throw new AppError(
            `Only pending or confirmed orders can be cancelled. Current status: ${order.status}`,
            400
        );
    }

    const activeItems = order.items.filter((i) => i.remainingQuantity > 0);

    try {
        await prisma.$transaction(async (tx) => {
            for (const item of activeItems) {
                const qty = item.remainingQuantity;

                // Same idempotencyKey across all items in this request — scoped
                // per item via the (orderItemId, idempotencyKey) unique constraint.
                await tx.orderItemAction.create({
                    data: { orderItemId: item.id, type: "CANCEL", quantity: qty, idempotencyKey },
                });

                const updated = await tx.orderItem.updateMany({
                    where: { id: item.id, remainingQuantity: { gte: qty } },
                    data: { remainingQuantity: { decrement: qty }, cancelledQuantity: { increment: qty } },
                });

                if (updated.count === 0) {
                    throw new AppError(`Failed to cancel item ${item.id} — quantity changed concurrently`, 409);
                }

                await tx.productVariant.update({
                    where: { id: item.productVariantId },
                    data: { stock: { increment: qty } },
                });
            }

            await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
        });
    } catch (err) {
        if (isIdempotencyConflict(err)) {
            const current = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
            if (current?.status === "CANCELLED") {
                return getOrderByIdForUser(orderId, userId);
            }
        }
        throw err;
    }

    return getOrderByIdForUser(orderId, userId);
}

// ============================================================
// ITEM-LEVEL CANCEL — restocks
// ============================================================

export async function cancelOrderItem(
    orderId: number,
    itemId: number,
    userId: number,
    quantity: number,
    idempotencyKey: string
) {
    const item = await prisma.orderItem.findFirst({
        where: { id: itemId, orderId, order: { userId } },
        select: {
            id: true,
            remainingQuantity: true,
            productVariantId: true,
            order: { select: { status: true } },
        },
    });

    if (!item) throw new AppError("Order item not found", 404);

    if (item.order.status !== "PENDING" && item.order.status !== "CONFIRMED") {
        throw new AppError(
            `Items can only be cancelled while the order is PENDING or CONFIRMED. Current status: ${item.order.status}`,
            400
        );
    }

    if (quantity > item.remainingQuantity) {
        throw new AppError(`Cannot cancel ${quantity} unit(s); only ${item.remainingQuantity} remain active`, 409);
    }

    try {
        return await prisma.$transaction(async (tx) => {
            await tx.orderItemAction.create({
                data: { orderItemId: itemId, type: "CANCEL", quantity, idempotencyKey },
            });

            const updated = await tx.orderItem.updateMany({
                where: { id: itemId, orderId, remainingQuantity: { gte: quantity } },
                data: { remainingQuantity: { decrement: quantity }, cancelledQuantity: { increment: quantity } },
            });

            if (updated.count === 0) {
                throw new AppError(`Cannot cancel ${quantity} unit(s); insufficient remaining quantity`, 409);
            }

            await tx.productVariant.update({
                where: { id: item.productVariantId },
                data: { stock: { increment: quantity } },
            });

            const remainingActive = await tx.orderItem.count({
                where: { orderId, remainingQuantity: { gt: 0 } },
            });

            if (remainingActive === 0) {
                await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
            }

            return tx.orderItem.findUniqueOrThrow({ where: { id: itemId } });
        });
    } catch (err) {
        if (isIdempotencyConflict(err)) {
            return prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
        }
        throw err;
    }
}

// ============================================================
// ITEM-LEVEL RETURN — no restock (deferred to admin inspection)
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
        where: { id: itemId, orderId, order: { userId } },
        select: { id: true, remainingQuantity: true, order: { select: { status: true } } },
    });

    if (!item) throw new AppError("Order item not found", 404);

    if (item.order.status !== "DELIVERED") {
        throw new AppError("Only items on delivered orders can be returned", 400);
    }

    if (quantity > item.remainingQuantity) {
        throw new AppError(`Cannot return ${quantity} unit(s); only ${item.remainingQuantity} remain eligible`, 409);
    }

    try {
        return await prisma.$transaction(async (tx) => {
            await tx.orderItemAction.create({
                data: { orderItemId: itemId, type: "RETURN", quantity, reason, idempotencyKey },
            });

            const updated = await tx.orderItem.updateMany({
                where: { id: itemId, orderId, remainingQuantity: { gte: quantity } },
                data: { remainingQuantity: { decrement: quantity }, returnedQuantity: { increment: quantity } },
            });

            if (updated.count === 0) {
                throw new AppError(`Cannot return ${quantity} unit(s); insufficient remaining quantity`, 409);
            }

            // No stock change here on purpose — restocking a return should
            // happen after physical inspection, via a separate admin flow.

            return tx.orderItem.findUniqueOrThrow({ where: { id: itemId } });
        });
    } catch (err) {
        if (isIdempotencyConflict(err)) {
            return prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
        }
        throw err;
    }
}

// ============================================================
// VERIFY RAZORPAY PAYMENT — stock already deducted at order
// creation for BOTH payment methods, so this must NOT touch
// productVariant.stock. Only flips payment/order status.
// ============================================================

export async function verifyPayment(
    orderId: number,
    userId: number,
    razorpayPaymentId: string,
    razorpaySignature: string
) {
    const order = await prisma.order.findFirst({
        where: { id: orderId, userId },
    });

    if (!order) throw new AppError("Order not found", 404);

    if (order.paymentStatus === "PAID") {
        return order;
    }

    if (order.paymentMethod !== "ONLINE") {
        throw new AppError("This order does not use online payment", 400);
    }

    if (!order.razorpayOrderId) {
        throw new AppError("Razorpay order ID is missing", 400);
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
        throw new AppError("Payment configuration error", 500);
    }

    const generatedSignature = crypto
        .createHmac("sha256", secret)
        .update(`${order.razorpayOrderId}|${razorpayPaymentId}`)
        .digest("hex");

    const generatedBuffer = Buffer.from(generatedSignature, "utf8");
    const receivedBuffer = Buffer.from(razorpaySignature, "utf8");

    if (
        generatedBuffer.length !== receivedBuffer.length ||
        !crypto.timingSafeEqual(generatedBuffer, receivedBuffer)
    ) {
        throw new AppError("Payment verification failed", 400);
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
        const currentOrder = await tx.order.findUnique({
            where: { id: orderId },
            select: { id: true, paymentStatus: true },
        });

        if (!currentOrder) throw new AppError("Order not found", 404);

        if (currentOrder.paymentStatus === "PAID") {
            return tx.order.findUnique({ where: { id: orderId } });
        }

        return tx.order.update({
            where: { id: orderId },
            data: {
                paymentStatus: "PAID",
                status: "CONFIRMED",
                razorpayPaymentId,
                razorpaySignature,
            },
        });
    });

    return updatedOrder;
}
