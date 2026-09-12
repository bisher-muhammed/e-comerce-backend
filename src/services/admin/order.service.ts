import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

import {
    OrderStatus,
    PaymentStatus,
    PaymentMethod,
} from "../../../generated/prisma/enums";

import { Prisma } from "../../../generated/prisma/client";

import { isUniqueConstraintOn } from "../../utils/transaction-retry.util";

import { ListOrdersQuery } from "../../validations/admin/order.validation";
import { calculateCancellationAmounts, sumGrossCancelled, } from "../../utils/order-amount.util";
import { releaseCouponClaimForOrder } from "../../utils/coupon-redemption.util";
import { cancelOrderItems } from "../../utils/order-cancellation.util";
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
        OrderStatus.SHIPPED,
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
    ],

    SHIPPED: [
        OrderStatus.DELIVERED,
        OrderStatus.CANCELLED,
    ],

    DELIVERED: [],

    CANCELLED: [],
};

const ADMIN_CANCELLABLE_STATUSES: OrderStatus[] = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.SHIPPED,
];

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
    return isUniqueConstraintOn(
        err,
        "idempotencyKey"
    );
}

// ============================================================
// LIST ORDERS
// ============================================================

const ORDER_LIST_SELECT = {
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
} satisfies Prisma.OrderSelect;

const SORT_COLUMNS: Record<
    ListOrdersQuery["sortBy"],
    string
> = {
    createdAt: "createdAt",
    total: "total",
    status: "status",
};

const searchedOrderIds = async (params: {
    search: string;
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    paymentMethod?: PaymentMethod;
    sortBy: ListOrdersQuery["sortBy"];
    sortOrder: ListOrdersQuery["sortOrder"];
    skip: number;
    take: number;
}) => {
    const {
        search,
        status,
        paymentStatus,
        paymentMethod,
        sortBy,
        sortOrder,
        skip,
        take,
    } = params;

    const pattern = `%${search}%`;

    const searchAsId = /^\d+$/.test(search)
        ? Number(search)
        : undefined;

    const conditions: Prisma.Sql[] = [
        Prisma.sql`o."id" IN (
                SELECT "id" FROM "Order"
                 WHERE "contactEmail" ILIKE ${pattern}
            UNION
                SELECT "id" FROM "Order"
                 WHERE "contactPhone" LIKE ${pattern}
            UNION
                SELECT "orderId" FROM "OrderItem"
                 WHERE "productName" ILIKE ${pattern}
            UNION
                SELECT o2."id" FROM "Order" o2
                  JOIN "User" u ON u."id" = o2."userId"
                 WHERE u."email" ILIKE ${pattern}
            ${
                searchAsId === undefined
                    ? Prisma.empty
                    : Prisma.sql`UNION SELECT ${searchAsId}::int`
            }
        )`,
    ];

    if (status) {
        conditions.push(
            Prisma.sql`o."status" = ${status}::"OrderStatus"`
        );
    }

    if (paymentStatus) {
        conditions.push(
            Prisma.sql`o."paymentStatus" = ${paymentStatus}::"PaymentStatus"`
        );
    }

    if (paymentMethod) {
        conditions.push(
            Prisma.sql`o."paymentMethod" = ${paymentMethod}::"PaymentMethod"`
        );
    }

    const whereSql = Prisma.join(
        conditions,
        " AND "
    );

    const sortColumn = Prisma.raw(
        `"${SORT_COLUMNS[sortBy]}"`
    );

    const direction = Prisma.raw(
        sortOrder === "asc" ? "ASC" : "DESC"
    );

    const [rows, counted] =
        await prisma.$transaction([
            prisma.$queryRaw<
                Array<{ id: number }>
            >`
                SELECT o."id"
                  FROM "Order" o
                 WHERE ${whereSql}
                 ORDER BY o.${sortColumn} ${direction}
                 LIMIT ${take} OFFSET ${skip}
            `,

            prisma.$queryRaw<
                Array<{ count: number }>
            >`
                SELECT COUNT(*)::int AS count
                  FROM "Order" o
                 WHERE ${whereSql}
            `,
        ]);

    return {
        ids: rows.map((row) => row.id),
        total: counted[0]?.count ?? 0,
    };
};

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

    let orders;
    let total: number;

    if (search) {
        const matched =
            await searchedOrderIds({
                search,
                status,
                paymentStatus,
                paymentMethod,
                sortBy,
                sortOrder,
                skip: (page - 1) * limit,
                take: limit,
            });

        total = matched.total;

        const unordered =
            matched.ids.length === 0
                ? []
                : await prisma.order.findMany({
                      where: {
                          id: {
                              in: matched.ids,
                          },
                      },

                      select: ORDER_LIST_SELECT,
                  });

        const byId = new Map(
            unordered.map((order) => [
                order.id,
                order,
            ])
        );

        orders = matched.ids
            .map((id) => byId.get(id))
            .filter(
                (
                    order
                ): order is (typeof unordered)[number] =>
                    order !== undefined
            );
    } else {
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
        };

        [orders, total] =
            await prisma.$transaction([
                prisma.order.findMany({
                    where,

                    orderBy: {
                        [sortBy]: sortOrder,
                    },

                    skip: (page - 1) * limit,

                    take: limit,

                    select: ORDER_LIST_SELECT,
                }),

                prisma.order.count({
                    where,
                }),
            ]);
    }

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
// CONFIRMED  → SHIPPED
// CONFIRMED  → DELIVERED
// CONFIRMED  → CANCELLED
//
// SHIPPED    → DELIVERED
// SHIPPED    → CANCELLED
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
                    !ADMIN_CANCELLABLE_STATUSES.includes(
                        order.status
                    )
                ) {
                    throw new AppError(
                        `Only ${ADMIN_CANCELLABLE_STATUSES.join(", ")} orders can be cancelled. Current status: ${order.status}`,
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

                await cancelOrderItems(tx, {
                    orderId,

                    items: activeItems,

                    reason: cleanReason,

                    idempotencyKey,
                });

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
