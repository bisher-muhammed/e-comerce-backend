/*
 * Returns (audit H4).
 *
 *   REQUESTED ──approve──▶ APPROVED ──receive──▶ RECEIVED ──(refund settles)──▶ REFUNDED
 *       │                                  ▲
 *       └────reject──▶ REJECTED            └── receive also allowed straight
 *                                              from REQUESTED (goods arrived)
 *
 * - A request reserves the units: OrderItem.remainingQuantity drops, so
 *   they cannot be requested twice or cancelled. Rejection gives them back.
 * - Receipt is the only point where money and stock move: the units become
 *   returnedQuantity, stock is released through the ledger
 *   (ORDER_RETURNED), the net value (coupon-allocated exactly like a
 *   cancellation) is added to Order.returnedAmount, and for an online
 *   payment a refund is issued through refund.service.
 * - COD orders were paid in cash; their refunds are recorded manually.
 */
import prisma from "../config/prisma";
import AppError from "../errors/AppError";
import { Prisma } from "../../generated/prisma/client";
import { StockMovementType } from "../../generated/prisma/enums";
import {
    calculateCancellationAmounts,
    sumGrossRemoved,
} from "../utils/order-amount.util";
import { releaseStock } from "../utils/stock.util";
import {
    isUniqueConstraintOn,
    withTransactionRetry,
} from "../utils/transaction-retry.util";
import {
    issueRefundForOrder,
    settleReturnsForOrder,
    type RefundOutcome,
} from "./refund.service";
import { logError } from "../utils/logger.util";

export const RETURN_WINDOW_DAYS = Number(
    process.env.RETURN_WINDOW_DAYS ?? 30
);

const TX_OPTIONS = {
    isolationLevel: "Serializable" as const,
    maxWait: 5000,
    timeout: 10000,
};

export const RETURN_PUBLIC_SELECT = {
    id: true,
    orderId: true,
    orderItemId: true,
    quantity: true,
    reason: true,
    status: true,
    adminNote: true,
    refundAmount: true,
    manualRefundReference: true,
    decidedAt: true,
    receivedAt: true,
    refundedAt: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.ReturnRequestSelect;

const itemMutationSelect = {
    id: true,
    remainingQuantity: true,
    cancelledQuantity: true,
    returnedQuantity: true,
    updatedAt: true,
} as const;

// ============================================================
// CUSTOMER: REQUEST
// ============================================================

export async function requestReturn(params: {
    orderId: number;
    itemId: number;
    userId: number;
    quantity: number;
    reason: string;
    idempotencyKey: string;
}) {
    const { orderId, itemId, userId, quantity, reason, idempotencyKey } =
        params;

    const replay = async () => {
        const existing = await prisma.returnRequest.findUnique({
            where: {
                orderItemId_idempotencyKey: {
                    orderItemId: itemId,
                    idempotencyKey,
                },
            },
            select: { ...RETURN_PUBLIC_SELECT, order: { select: { userId: true } } },
        });

        if (!existing || existing.order.userId !== userId) {
            return null;
        }

        if (existing.quantity !== quantity) {
            throw new AppError(
                "This return was already submitted with different details",
                409
            );
        }

        const { order: _order, ...returnRequest } = existing;

        return {
            ...(await prisma.orderItem.findUniqueOrThrow({
                where: { id: itemId },
                select: itemMutationSelect,
            })),
            returnRequest,
        };
    };

    const replayed = await replay();
    if (replayed) {
        return replayed;
    }

    try {
        return await withTransactionRetry(() =>
            prisma.$transaction(async (tx) => {
                const item = await tx.orderItem.findFirst({
                    where: { id: itemId, orderId, order: { userId } },
                    select: {
                        id: true,
                        remainingQuantity: true,
                        order: {
                            select: { status: true, deliveredAt: true },
                        },
                    },
                });

                if (!item) {
                    throw new AppError("Order item not found", 404);
                }

                if (item.order.status !== "DELIVERED") {
                    throw new AppError(
                        "Only items on delivered orders can be returned",
                        400
                    );
                }

                const deliveredAt = item.order.deliveredAt;
                const windowEnds = deliveredAt
                    ? deliveredAt.getTime() +
                      RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000
                    : 0;

                if (!deliveredAt || Date.now() > windowEnds) {
                    throw new AppError(
                        `Returns are accepted within ${RETURN_WINDOW_DAYS} days of delivery`,
                        400
                    );
                }

                const reserved = await tx.orderItem.updateMany({
                    where: {
                        id: itemId,
                        remainingQuantity: { gte: quantity },
                    },
                    data: { remainingQuantity: { decrement: quantity } },
                });

                if (reserved.count === 0) {
                    throw new AppError(
                        `Cannot return ${quantity} unit(s); only ${item.remainingQuantity} remain eligible`,
                        409
                    );
                }

                const returnRequest = await tx.returnRequest.create({
                    data: {
                        orderId,
                        orderItemId: itemId,
                        quantity,
                        reason,
                        idempotencyKey,
                    },
                    select: RETURN_PUBLIC_SELECT,
                });

                return {
                    ...(await tx.orderItem.findUniqueOrThrow({
                        where: { id: itemId },
                        select: itemMutationSelect,
                    })),
                    returnRequest,
                };
            }, TX_OPTIONS)
        );
    } catch (error) {
        if (isUniqueConstraintOn(error, "idempotencyKey")) {
            const again = await replay();
            if (again) {
                return again;
            }
        }

        throw error;
    }
}

// ============================================================
// ADMIN: DECIDE
// ============================================================

const loadReturn = async (returnId: number) => {
    const found = await prisma.returnRequest.findUnique({
        where: { id: returnId },
        select: RETURN_PUBLIC_SELECT,
    });

    if (!found) {
        throw new AppError("Return request not found", 404);
    }

    return found;
};

const assertStatus = (
    current: string,
    allowed: string[],
    action: string
) => {
    if (!allowed.includes(current)) {
        throw new AppError(
            `Cannot ${action} a return that is ${current}`,
            409
        );
    }
};

export async function approveReturn(returnId: number, note?: string) {
    const current = await loadReturn(returnId);

    if (current.status === "APPROVED") {
        return current;
    }

    assertStatus(current.status, ["REQUESTED"], "approve");

    const moved = await prisma.returnRequest.updateMany({
        where: { id: returnId, status: "REQUESTED" },
        data: {
            status: "APPROVED",
            decidedAt: new Date(),
            ...(note !== undefined ? { adminNote: note } : {}),
        },
    });

    if (moved.count === 0) {
        throw new AppError("Return changed concurrently — please retry", 409);
    }

    return loadReturn(returnId);
}

export async function rejectReturn(returnId: number, note: string) {
    const current = await loadReturn(returnId);

    if (current.status === "REJECTED") {
        return current;
    }

    assertStatus(current.status, ["REQUESTED", "APPROVED"], "reject");

    await prisma.$transaction(async (tx) => {
        const moved = await tx.returnRequest.updateMany({
            where: {
                id: returnId,
                status: { in: ["REQUESTED", "APPROVED"] },
            },
            data: {
                status: "REJECTED",
                decidedAt: new Date(),
                adminNote: note,
            },
        });

        if (moved.count === 0) {
            throw new AppError(
                "Return changed concurrently — please retry",
                409
            );
        }

        // The units go back to the customer's order.
        await tx.orderItem.update({
            where: { id: current.orderItemId },
            data: { remainingQuantity: { increment: current.quantity } },
        });
    }, TX_OPTIONS);

    return loadReturn(returnId);
}

// ============================================================
// ADMIN: RECEIVE (money + stock move here)
// ============================================================

export async function receiveReturn(returnId: number, note?: string) {
    const current = await loadReturn(returnId);

    if (!["RECEIVED", "REFUNDED"].includes(current.status)) {
        assertStatus(current.status, ["REQUESTED", "APPROVED"], "receive");

        await withTransactionRetry(() =>
            prisma.$transaction(async (tx) => {
                const moved = await tx.returnRequest.updateMany({
                    where: {
                        id: returnId,
                        status: { in: ["REQUESTED", "APPROVED"] },
                    },
                    data: {
                        status: "RECEIVED",
                        receivedAt: new Date(),
                        decidedAt: current.decidedAt ?? new Date(),
                        ...(note !== undefined ? { adminNote: note } : {}),
                    },
                });

                if (moved.count === 0) {
                    throw new AppError(
                        "Return changed concurrently — please retry",
                        409
                    );
                }

                const order = await tx.order.findUniqueOrThrow({
                    where: { id: current.orderId },
                    select: {
                        subtotal: true,
                        couponDiscount: true,
                        cancelledAmount: true,
                        returnedAmount: true,
                        items: {
                            select: {
                                id: true,
                                price: true,
                                productVariantId: true,
                                cancelledQuantity: true,
                                returnedQuantity: true,
                            },
                        },
                    },
                });

                const item = order.items.find(
                    (i) => i.id === current.orderItemId
                )!;

                const { netCancellationAmount: netReturned } =
                    calculateCancellationAmounts({
                        subtotal: order.subtotal,
                        couponDiscount: order.couponDiscount,
                        grossCancelledBefore: sumGrossRemoved(order.items),
                        netCancelledBefore: order.cancelledAmount.add(
                            order.returnedAmount
                        ),
                        grossCancelledNow: item.price.mul(current.quantity),
                    });

                await tx.orderItem.update({
                    where: { id: item.id },
                    data: {
                        returnedQuantity: { increment: current.quantity },
                    },
                });

                await tx.orderItemAction.create({
                    data: {
                        orderItemId: item.id,
                        type: "RETURN",
                        quantity: current.quantity,
                        reason: current.reason,
                        idempotencyKey: `return:${returnId}`,
                    },
                });

                await tx.order.update({
                    where: { id: current.orderId },
                    data: { returnedAmount: { increment: netReturned } },
                });

                await tx.returnRequest.update({
                    where: { id: returnId },
                    data: { refundAmount: netReturned },
                });

                await releaseStock(
                    tx,
                    [
                        {
                            productVariantId: item.productVariantId,
                            quantity: current.quantity,
                            orderItemId: item.id,
                        },
                    ],
                    StockMovementType.ORDER_RETURNED
                );
            }, TX_OPTIONS)
        );
    }

    let refund: RefundOutcome | null = null;

    try {
        refund = await issueRefundForOrder(
            current.orderId,
            `return:${returnId}`,
            `Return #${returnId}`
        );
    } catch (error) {
        // The refund worker re-issues whatever is still owed.
        logError("return.refund_error", error, {
            orderId: current.orderId,
            alert: true,
        });
    }

    await settleReturnsForOrder(current.orderId);

    return { returnRequest: await loadReturn(returnId), refund };
}

/** COD: money went back outside Razorpay; record it. */
export async function markReturnRefundedManually(
    returnId: number,
    reference: string
) {
    const current = await loadReturn(returnId);

    if (current.status === "REFUNDED") {
        return current;
    }

    assertStatus(current.status, ["RECEIVED"], "mark as refunded");

    const order = await prisma.order.findUniqueOrThrow({
        where: { id: current.orderId },
        select: { paymentMethod: true },
    });

    if (order.paymentMethod === "ONLINE") {
        throw new AppError(
            "Online payments are refunded through Razorpay automatically",
            409
        );
    }

    await prisma.$transaction(async (tx) => {
        const moved = await tx.returnRequest.updateMany({
            where: { id: returnId, status: "RECEIVED" },
            data: {
                status: "REFUNDED",
                refundedAt: new Date(),
                manualRefundReference: reference,
            },
        });

        if (moved.count === 0) {
            throw new AppError(
                "Return changed concurrently — please retry",
                409
            );
        }

        await tx.order.update({
            where: { id: current.orderId },
            data: {
                refundedAmount: {
                    increment: current.refundAmount ?? 0,
                },
            },
        });
    });

    return loadReturn(returnId);
}

// ============================================================
// ADMIN: LIST
// ============================================================

export async function listReturns(params: {
    status?: "REQUESTED" | "APPROVED" | "REJECTED" | "RECEIVED" | "REFUNDED";
    page: number;
    limit: number;
}) {
    const where: Prisma.ReturnRequestWhereInput = params.status
        ? { status: params.status }
        : {};

    const [returns, total] = await prisma.$transaction([
        prisma.returnRequest.findMany({
            where,
            select: {
                ...RETURN_PUBLIC_SELECT,
                orderItem: {
                    select: {
                        productName: true,
                        colorName: true,
                        sizeName: true,
                        price: true,
                    },
                },
                order: {
                    select: { paymentMethod: true, contactEmail: true },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: (params.page - 1) * params.limit,
            take: params.limit,
        }),
        prisma.returnRequest.count({ where }),
    ]);

    const totalPages = Math.max(Math.ceil(total / params.limit), 1);

    return {
        returns,
        pagination: {
            page: params.page,
            limit: params.limit,
            total,
            totalPages,
            hasNextPage: params.page < totalPages,
            hasPreviousPage: params.page > 1,
        },
    };
}
