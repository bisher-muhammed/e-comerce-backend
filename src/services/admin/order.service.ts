import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

import {
    OrderStatus,
    PaymentStatus,
    PaymentMethod,
} from "../../../generated/prisma/enums";

import { Prisma } from "../../../generated/prisma/client";

import { ListOrdersQuery } from "../../validations/admin/order.validation";
import { calculateCancellationAmounts, sumGrossCancelled, } from "../../utils/order-amount.util";
import { releaseCouponClaimForOrder } from "../../utils/coupon-redemption.util";
import { issueRefundAfterCancellation, issueRefundForOrder, RefundOutcome, } from "../refund.service";


const ORDER_STATUS_TRANSITIONS: Record<
    OrderStatus,
    OrderStatus[]
> = {
    PENDING: [
        OrderStatus.CONFIRMED,
        OrderStatus.CANCELLED,
    ],

    CONFIRMED: [
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
    ],

    DELIVERED: [],

    CANCELLED: [],
};

// ============================================================
// VALID NEXT STATUSES
// ============================================================

export const getValidNextStatuses = (
    current: OrderStatus
): OrderStatus[] => {
    return ORDER_STATUS_TRANSITIONS[current];
};

// ============================================================
// IDEMPOTENCY ERROR
// ============================================================

function isIdempotencyConflict(err: unknown): boolean {
    return (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
    );
}

// ============================================================
// LIST ORDERS
// ============================================================

export const listOrders = async (
    query: ListOrdersQuery
) => {
    const {
        page,
        limit,
        status,
        paymentStatus,
        paymentMethod,
        search,
        sortBy,
        sortOrder,
    } = query;

    const searchAsId =
        search && /^\d+$/.test(search)
            ? Number(search)
            : undefined;

    // --------------------------------------------------------
    // WHERE
    // --------------------------------------------------------

    const where: Prisma.OrderWhereInput = {
        ...(status && {
            status,
        }),

        ...(paymentStatus && {
            paymentStatus,
        }),

        ...(paymentMethod && {
            paymentMethod,
        }),

        ...(search && {
            OR: [
                // Order ID
                ...(searchAsId !== undefined
                    ? [{ id: searchAsId }]
                    : []),

                // Customer email
                {
                    contactEmail: {
                        contains: search,
                        mode: "insensitive",
                    },
                },

                // Customer phone
                {
                    contactPhone: {
                        contains: search,
                    },
                },

                // Product name
                {
                    items: {
                        some: {
                            productName: {
                                contains: search,
                                mode: "insensitive",
                            },
                        },
                    },
                },

                // User email
                {
                    user: {
                        email: {
                            contains: search,
                            mode: "insensitive",
                        },
                    },
                },
            ],
        }),
    };

    // --------------------------------------------------------
    // QUERY
    // --------------------------------------------------------

    const [orders, total] = await prisma.$transaction([
        prisma.order.findMany({
            where,

            orderBy: {
                [sortBy]: sortOrder,
            },

            skip: (page - 1) * limit,

            take: limit,

            select: {
                id: true,

                status: true,

                paymentStatus: true,

                paymentMethod: true,

                contactEmail: true,

                contactPhone: true,

                subtotal: true,

                total: true,

                cancelledAmount: true,

                refundedAmount: true,

                cancellationReason: true,

                expiresAt: true,

                createdAt: true,

                updatedAt: true,

                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },

                _count: {
                    select: {
                        items: true,
                    },
                },
            },
        }),

        prisma.order.count({
            where,
        }),
    ]);

    // --------------------------------------------------------
    // PAGINATION
    // --------------------------------------------------------

    const totalPages = Math.max(
        Math.ceil(total / limit),
        1
    );

    return {
        orders: orders.map((order) => ({
            ...order,

            nextStatuses:
                getValidNextStatuses(order.status),
        })),

        pagination: {
            page,
            limit,
            total,
            totalPages,

            hasNextPage:
                page < totalPages,

            hasPreviousPage:
                page > 1,
        },
    };
};

// ============================================================
// GET ORDER DETAILS
// ============================================================

export const getOrderDetails = async (
    orderId: number
) => {
    const order = await prisma.order.findUnique({
        where: {
            id: orderId,
        },

        include: {
            user: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    status: true,
                },
            },

            items: {
                include: {
                    productVariant: {
                        include: {
                            size: {
                                select: {
                                    name: true,
                                },
                            },

                            productColor: {
                                include: {
                                    color: {
                                        select: {
                                            name: true,
                                            hexCode: true,
                                        },
                                    },

                                    product: {
                                        select: {
                                            id: true,
                                            name: true,
                                            slug: true,
                                        },
                                    },

                                    images: {
                                        where: {
                                            isPrimary: true,
                                        },

                                        take: 1,

                                        select: {
                                            url: true,
                                            altText: true,
                                        },
                                    },
                                },
                            },
                        },
                    },

                    actions: {
                        orderBy: {
                            createdAt: "desc",
                        },
                    },
                },
            },
        },
    });

    if (!order) {
        throw new AppError(
            "Order not found",
            404
        );
    }

    return {
        ...order,

        nextStatuses:
            getValidNextStatuses(order.status),
    };
};

// ============================================================
// UPDATE ORDER STATUS
// ============================================================
//
// Handles:
//
// PENDING    → CONFIRMED
// PENDING    → CANCELLED
//
// CONFIRMED  → DELIVERED
// CONFIRMED  → CANCELLED
//
// DELIVERED  → nothing
// CANCELLED  → nothing
//
// For cancellation:
//
// 1. Validate transition
// 2. Cancel every remaining item quantity
// 3. Create OrderItemAction
// 4. Increase cancelledQuantity
// 5. Decrease remainingQuantity
// 6. Restore stock
// 7. Calculate cancellation amount
// 8. Increase cancelledAmount
// 9. Decrease subtotal
// 10. Decrease total
// 11. Store cancellation reason
// 12. Change order status
//
// Everything happens in one transaction.
//
// ============================================================

export const updateOrderStatus = async (
    orderId: number,
    nextStatus: OrderStatus,
    reason?: string,
    idempotencyKey?: string
) => {
    // ========================================================
    // NORMAL STATUS CHANGE
    // ========================================================

    if (nextStatus !== OrderStatus.CANCELLED) {
        return prisma.$transaction(
            async (tx) => {
                const order =
                    await tx.order.findUnique({
                        where: {
                            id: orderId,
                        },

                        select: {
                            id: true,
                            status: true,
                            paymentMethod: true,
                            paymentStatus: true,
                        },
                    });

                if (!order) {
                    throw new AppError(
                        "Order not found",
                        404
                    );
                }

                const allowed =
                    getValidNextStatuses(
                        order.status
                    );

                if (!allowed.includes(nextStatus)) {
                    const message =
                        allowed.length === 0
                            ? `Order is already in a terminal state (${order.status}) and cannot be changed`
                            : `Cannot move order from ${order.status} to ${nextStatus}. Allowed next statuses: ${allowed.join(", ")}`;

                    throw new AppError(
                        message,
                        400
                    );
                }

                const data: Prisma.OrderUpdateInput = {
                    status: nextStatus,
                };

                // ------------------------------------------------
                // COD becomes paid when delivered
                // ------------------------------------------------

                if (
                    nextStatus ===
                        OrderStatus.DELIVERED &&
                    order.paymentMethod ===
                        PaymentMethod.COD
                ) {
                    data.paymentStatus =
                        PaymentStatus.PAID;
                }

                // ------------------------------------------------
                // Atomic status guard
                // ------------------------------------------------

                const updated =
                    await tx.order.updateMany({
                        where: {
                            id: orderId,

                            status: order.status,
                        },

                        data,
                    });

                if (updated.count === 0) {
                    throw new AppError(
                        "Order status changed concurrently — please retry",
                        409
                    );
                }

                return tx.order.findUniqueOrThrow({
                    where: {
                        id: orderId,
                    },
                });
            }
        );
    }

    // ========================================================
    // CANCELLATION VALIDATION
    // ========================================================

    if (!reason || reason.trim().length < 5) {
        throw new AppError(
            "A cancellation reason of at least 5 characters is required",
            400
        );
    }

    if (!idempotencyKey) {
        throw new AppError(
            "idempotencyKey is required when cancelling an order",
            400
        );
    }

    const cleanReason = reason.trim();

    // ========================================================
    // CANCELLATION TRANSACTION
    // ========================================================

    try {
        await prisma.$transaction(
            async (tx) => {
                // ------------------------------------------------
                // Read current order inside transaction
                // ------------------------------------------------

                const order =
                    await tx.order.findUnique({
                        where: {
                            id: orderId,
                        },

                        select: {
                            id: true,
                            status: true,

                            subtotal: true,
                            couponDiscount: true,
                            cancelledAmount: true,

                            items: {
                                select: {
                                    id: true,
                                    price: true,
                                    remainingQuantity: true,
                                    cancelledQuantity: true,
                                    productVariantId: true,
                                },
                            },
                        },
                    });

                if (!order) {
                    throw new AppError(
                        "Order not found",
                        404
                    );
                }

                // ------------------------------------------------
                // Already cancelled
                // ------------------------------------------------

                if (
                    order.status ===
                    OrderStatus.CANCELLED
                ) {
                    return tx.order.findUniqueOrThrow({
                        where: {
                            id: orderId,
                        },
                    });
                }

                // ------------------------------------------------
                // Cancellation allowed only from:
                //
                // PENDING
                // CONFIRMED
                // ------------------------------------------------

                if (
                    order.status !==
                        OrderStatus.PENDING &&
                    order.status !==
                        OrderStatus.CONFIRMED
                ) {
                    throw new AppError(
                        `Only pending or confirmed orders can be cancelled. Current status: ${order.status}`,
                        400
                    );
                }

                // ------------------------------------------------
                // Active items
                //
                // Items partially cancelled by the customer are
                // already represented by remainingQuantity.
                //
                // Example:
                //
                // quantity          = 5
                // cancelledQuantity = 2
                // remainingQuantity = 3
                //
                // Admin cancellation cancels only those 3.
                // ------------------------------------------------

                const activeItems =
                    order.items.filter(
                        (item) =>
                            item.remainingQuantity > 0
                    );

                if (activeItems.length === 0) {
                    throw new AppError(
                        "Order has no remaining quantity to cancel",
                        409
                    );
                }

                // ------------------------------------------------
                // Calculate cancellation amount
                // ------------------------------------------------

                let grossCancelledNow =
                    new Prisma.Decimal(0);

                for (const item of activeItems) {
                    grossCancelledNow =
                        grossCancelledNow.add(
                            item.price.mul(
                                item.remainingQuantity
                            )
                        );
                }

                const {
                    netCancellationAmount,
                } = calculateCancellationAmounts({
                    subtotal: order.subtotal,

                    couponDiscount:
                        order.couponDiscount,

                    grossCancelledBefore:
                        sumGrossCancelled(
                            order.items
                        ),

                    netCancelledBefore:
                        order.cancelledAmount,

                    grossCancelledNow,
                });

                // ------------------------------------------------
                // Cancel each active item
                // ------------------------------------------------

                for (const item of activeItems) {
                    const quantity =
                        item.remainingQuantity;

                    // --------------------------------------------
                    // Record action
                    // --------------------------------------------

                    await tx.orderItemAction.create({
                        data: {
                            orderItemId: item.id,

                            type: "CANCEL",

                            quantity,

                            reason: cleanReason,

                            idempotencyKey,
                        },
                    });

                    // --------------------------------------------
                    // Atomic quantity update
                    // --------------------------------------------

                    const updatedItem =
                        await tx.orderItem.updateMany({
                            where: {
                                id: item.id,

                                orderId,

                                remainingQuantity: {
                                    gte: quantity,
                                },
                            },

                            data: {
                                remainingQuantity: {
                                    decrement:
                                        quantity,
                                },

                                cancelledQuantity: {
                                    increment:
                                        quantity,
                                },
                            },
                        });

                    if (
                        updatedItem.count === 0
                    ) {
                        throw new AppError(
                            `Failed to cancel item ${item.id} — quantity changed concurrently`,
                            409
                        );
                    }

                    // --------------------------------------------
                    // Restore stock
                    // --------------------------------------------

                    await tx.productVariant.update({
                        where: {
                            id: item.productVariantId,
                        },

                        data: {
                            stock: {
                                increment:
                                    quantity,
                            },
                        },
                    });
                }

                // ------------------------------------------------
                // Update order financial values
                //
                // Original amount:
                //
                // subtotal       = ₹3000
                // couponDiscount = ₹300
                // total          = ₹2700
                //
                // Cancelled:
                //
                // ₹1000 gross → ₹100 of the discount → ₹900 net
                //
                // Result:
                //
                // ------------------------------------------------

                await tx.order.update({
                    where: {
                        id: orderId,
                    },

                    data: {
                        status:
                            OrderStatus.CANCELLED,

                        cancellationReason:
                            cleanReason,

                        cancelledAmount: {
                            increment:
                                netCancellationAmount,
                        },
                    },
                });

                await releaseCouponClaimForOrder(
                    tx,
                    orderId
                );

                // ------------------------------------------------
                // Return complete updated order
                // ------------------------------------------------

                return tx.order.findUniqueOrThrow({
                    where: {
                        id: orderId,
                    },
                });
            }
        );
    } catch (err) {
        // ========================================================
        // IDEMPOTENCY
        // ========================================================

        if (isIdempotencyConflict(err)) {
            const currentOrder =
                await prisma.order.findUnique({
                    where: {
                        id: orderId,
                    },

                    select: {
                        status: true,
                    },
                });

            // If the cancellation already completed,
            // return the current order instead of performing
            // cancellation again.
            if (
                currentOrder?.status ===
                OrderStatus.CANCELLED
            ) {
                await issueRefundAfterCancellation(
                    orderId,
                    idempotencyKey,
                    cleanReason
                );

                return prisma.order.findUniqueOrThrow({
                    where: {
                        id: orderId,
                    },
                });
            }
        }

        throw err;
    }

    await issueRefundAfterCancellation(
        orderId,
        idempotencyKey,
        cleanReason
    );

    return prisma.order.findUniqueOrThrow({
        where: {
            id: orderId,
        },
    });
};

export const refundOrder = async (
    orderId: number,
    idempotencyKey: string,
    reason?: string
): Promise<{
    order: Prisma.OrderGetPayload<{}>;
    refund: RefundOutcome;
}> => {
    const order =
        await prisma.order.findUnique({
            where: {
                id: orderId,
            },

            select: {
                id: true,
            },
        });

    if (!order) {
        throw new AppError(
            "Order not found",
            404
        );
    }

    const refund =
        await issueRefundForOrder(
            orderId,
            idempotencyKey,
            reason
        );

    return {
        order: await prisma.order.findUniqueOrThrow(
            {
                where: {
                    id: orderId,
                },
            }
        ),

        refund,
    };
};
