import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

import { OrderStatus, StockMovementType } from "../../../generated/prisma/enums";
import { releaseStock } from "../../utils/stock.util";
import { Prisma } from "../../../generated/prisma/client";
import { calculateCancellationAmounts, sumGrossCancelled, } from "../../utils/order-amount.util";
import { releaseCouponClaimForOrder } from "../../utils/coupon-redemption.util";
import { cancelOrderItems } from "../../utils/order-cancellation.util";
import {
    isUniqueConstraintOn,
    withTransactionRetry,
} from "../../utils/transaction-retry.util";
import { issueRefundAfterCancellation } from "../refund.service";
import { requestReturn, RETURN_PUBLIC_SELECT } from "../return.service";
import * as checkoutService from "./checkout.service";



const CANCELLATION_TRANSACTION_OPTIONS = {
    isolationLevel: "Serializable" as const,
    maxWait: 5000,
    timeout: 10000,
};



function isIdempotencyConflict(err: unknown): boolean {
    return isUniqueConstraintOn(
        err,
        "idempotencyKey"
    );
}


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
    shippingLandmark: true,
    shippingCity: true,
    shippingState: true,
    shippingPostalCode: true,
    shippingCountry: true,

    // Financial values
    subtotal: true,
    couponCode: true,
    couponDiscount: true,
    total: true,
    cancelledAmount: true,
    refundedAmount: true,

    returnedAmount: true,

    cancellationReason: true,

    // Payment window
    expiresAt: true,

    deliveredAt: true,

    returns: {
        select: RETURN_PUBLIC_SELECT,
        orderBy: { createdAt: "desc" as const },
    },

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
                                where: {
                                    isPrimary: true,
                                },
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
                      ...(startDate && {
                          gte: startDate,
                      }),
                      ...(endDate && {
                          lte: endDate,
                      }),
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
                couponCode: true,
                couponDiscount: true,
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
        },
    });

    if (!order) {
        throw new AppError("Order not found", 404);
    }



    if (order.status === "CANCELLED") {
        const refund = await issueRefundAfterCancellation(
            orderId,
            idempotencyKey,
            reason
        );

        return {
            ...(await getOrderByIdForUser(orderId, userId)),
            refund,
        };
    }



    if (
        order.status !== "PENDING" &&
        order.status !== "CONFIRMED"
    ) {
        throw new AppError(
            `Only pending or confirmed orders can be cancelled. Current status: ${order.status}`,
            400
        );
    }

    try {
        await withTransactionRetry(() =>
            prisma.$transaction(async (tx) => {

            const currentOrder =
                await tx.order.findUnique({
                    where: {
                        id: orderId,
                    },

                    select: {
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

            if (!currentOrder) {
                throw new AppError(
                    "Order not found",
                    404
                );
            }

            if (
                currentOrder.status !==
                    "PENDING" &&
                currentOrder.status !==
                    "CONFIRMED"
            ) {
                throw new AppError(
                    `Only pending or confirmed orders can be cancelled. Current status: ${currentOrder.status}`,
                    400
                );
            }

            const activeItems =
                currentOrder.items.filter(
                    (item) =>
                        item.remainingQuantity >
                        0
                );

            if (activeItems.length === 0) {
                throw new AppError(
                    "Order has no remaining quantity to cancel",
                    409
                );
            }

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
                subtotal:
                    currentOrder.subtotal,

                couponDiscount:
                    currentOrder.couponDiscount,

                grossCancelledBefore:
                    sumGrossCancelled(
                        currentOrder.items
                    ),

                netCancelledBefore:
                    currentOrder.cancelledAmount,

                grossCancelledNow,
            });


            await cancelOrderItems(tx, {
                orderId,

                items: activeItems,

                reason,

                idempotencyKey,
            });



            await tx.order.update({
                where: {
                    id: orderId,
                },

                data: {
                    status: "CANCELLED",

                    cancellationReason:
                        reason,

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
            },
            CANCELLATION_TRANSACTION_OPTIONS
            )
        );
    } catch (err) {


        if (isIdempotencyConflict(err)) {
            const current =
                await prisma.order.findUnique({
                    where: {
                        id: orderId,
                    },

                    select: {
                        status: true,
                    },
                });

            if (
                current?.status ===
                "CANCELLED"
            ) {
                const refund = await issueRefundAfterCancellation(
                    orderId,
                    idempotencyKey,
                    reason
                );

                return {
                    ...(await getOrderByIdForUser(orderId, userId)),
                    refund,
                };
            }
        }

        throw err;
    }

    const refund = await issueRefundAfterCancellation(
        orderId,
        idempotencyKey,
        reason
    );

    return {
        ...(await getOrderByIdForUser(orderId, userId)),
        refund,
    };
}



const orderItemMutationSelect = {
    id: true,
    remainingQuantity: true,
    cancelledQuantity: true,
    returnedQuantity: true,
    updatedAt: true,
} as const;



export async function cancelOrderItem(
    orderId: number,
    itemId: number,
    userId: number,
    quantity: number,
    idempotencyKey: string,
    reason?: string
) {
    let result: {
        id: number;
        remainingQuantity: number;
        cancelledQuantity: number;
        returnedQuantity: number;
        updatedAt: Date;
    };

    try {
        result = await withTransactionRetry(() =>
            prisma.$transaction(
            async (tx) => {
                // ------------------------------------------------
                // Read CURRENT order financial values.
                //
                // This must happen inside the transaction.
                // ------------------------------------------------

                const item =
                    await tx.orderItem.findFirst({
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
                                    paymentMethod: true,
                                    paymentStatus: true,
                                },
                            },
                        },
                    });

                if (!item) {
                    throw new AppError(
                        "Order item not found",
                        404
                    );
                }

                // The Razorpay order was created for the full amount and
                // cannot shrink; cancelling a line before capture would
                // still charge for it (audit M2).
                if (
                    item.order.paymentMethod === "ONLINE" &&
                    item.order.paymentStatus !== "PAID"
                ) {
                    throw new AppError(
                        "Items can't be cancelled individually until the payment is complete. Cancel the whole order instead.",
                        409
                    );
                }

                if (
                    item.order.status !==
                        "PENDING" &&
                    item.order.status !==
                        "CONFIRMED"
                ) {
                    throw new AppError(
                        `Items can only be cancelled while the order is PENDING or CONFIRMED. Current status: ${item.order.status}`,
                        400
                    );
                }

                if (
                    quantity >
                    item.remainingQuantity
                ) {
                    throw new AppError(
                        `Cannot cancel ${quantity} unit(s); only ${item.remainingQuantity} remain active`,
                        409
                    );
                }

                const cancellationAmount =
                    item.price.mul(quantity);

                const currentOrder =
                    await tx.order.findUnique({
                        where: {
                            id: orderId,
                        },

                        select: {
                            subtotal: true,
                            couponDiscount: true,
                            cancelledAmount: true,

                            items: {
                                select: {
                                    price: true,
                                    cancelledQuantity: true,
                                },
                            },
                        },
                    });

                if (!currentOrder) {
                    throw new AppError(
                        "Order not found",
                        404
                    );
                }



                await tx.orderItemAction.create({
                    data: {
                        orderItemId: itemId,
                        type: "CANCEL",
                        quantity,
                        reason,
                        idempotencyKey,
                    },
                });



                const updated =
                    await tx.orderItem.updateMany({
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



                // Through the ledger, linked to the order item (M11).
                await releaseStock(
                    tx,
                    [
                        {
                            productVariantId: item.productVariantId,
                            quantity,
                            orderItemId: item.id,
                        },
                    ],
                    StockMovementType.ORDER_CANCELLED
                );



                const {
                    netCancellationAmount,
                } = calculateCancellationAmounts({
                    subtotal:
                        currentOrder.subtotal,

                    couponDiscount:
                        currentOrder.couponDiscount,

                    grossCancelledBefore:
                        sumGrossCancelled(
                            currentOrder.items
                        ),

                    netCancelledBefore:
                        currentOrder.cancelledAmount,

                    grossCancelledNow:
                        cancellationAmount,
                });



                const remainingActive =
                    await tx.orderItem.count({
                        where: {
                            orderId,

                            remainingQuantity: {
                                gt: 0,
                            },
                        },
                    });


                await tx.order.update({
                    where: {
                        id: orderId,
                    },

                    data: {
                        ...(remainingActive ===
                            0 && {
                            status: "CANCELLED",
                        }),

                        cancelledAmount: {
                            increment:
                                netCancellationAmount,
                        },
                    },
                });

                if (remainingActive === 0) {
                    await releaseCouponClaimForOrder(
                        tx,
                        orderId
                    );
                }


                return tx.orderItem.findUniqueOrThrow({
                    where: {
                        id: itemId,
                    },

                    select:
                        orderItemMutationSelect,
                });
            },
            CANCELLATION_TRANSACTION_OPTIONS
            )
        );
    } catch (err) {


        if (isIdempotencyConflict(err)) {
            const refund = await issueRefundAfterCancellation(
                orderId,
                idempotencyKey,
                reason
            );

            return {
                ...(await prisma.orderItem.findUniqueOrThrow({
                    where: {
                        id: itemId,
                    },

                    select:
                        orderItemMutationSelect,
                })),
                refund,
            };
        }

        throw err;
    }

    const refund = await issueRefundAfterCancellation(
        orderId,
        idempotencyKey,
        reason
    );

    return { ...result, refund };
}



export async function returnOrderItem(
    orderId: number,
    itemId: number,
    userId: number,
    quantity: number,
    reason: string,
    idempotencyKey: string
) {
    return requestReturn({
        orderId,
        itemId,
        userId,
        quantity,
        reason,
        idempotencyKey,
    });
}



export async function verifyPayment(
    orderId: number,
    userId: number,
    razorpayPaymentId: string,
    razorpaySignature: string
) {
    const order =
        await prisma.order.findFirst({
            where: {
                id: orderId,
                userId,
            },

            select: {
                paymentMethod: true,
                razorpayOrderId: true,
            },
        });

    if (!order) {
        throw new AppError(
            "Order not found",
            404
        );
    }

    if (
        order.paymentMethod !== "ONLINE"
    ) {
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

    return checkoutService.verifyPayment(
        userId,
        order.razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
    );
}