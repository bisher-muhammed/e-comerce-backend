import crypto from "crypto";

import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

import { OrderStatus } from "../../../generated/prisma/enums";
import { Prisma } from "../../../generated/prisma/client";



function isIdempotencyConflict(err: unknown): boolean {
    return (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
    );
}


function calculateCouponDiscountPortion(
    orderSubtotal: Prisma.Decimal,
    orderCouponDiscount: Prisma.Decimal | null,
    cancellationAmount: Prisma.Decimal
): Prisma.Decimal {
    if (
        !orderCouponDiscount ||
        orderCouponDiscount.lte(0) ||
        orderSubtotal.lte(0) ||
        cancellationAmount.lte(0)
    ) {
        return new Prisma.Decimal(0);
    }

    const portion = orderCouponDiscount
        .mul(cancellationAmount)
        .div(orderSubtotal)
        .toDecimalPlaces(2);

    return Prisma.Decimal.min(
        portion,
        orderCouponDiscount
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



    if (order.status === "CANCELLED") {
        return getOrderByIdForUser(
            orderId,
            userId
        );
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

    const activeItems = order.items.filter(
        (item) =>
            item.remainingQuantity > 0
    );

    if (activeItems.length === 0) {
        throw new AppError(
            "Order has no remaining quantity to cancel",
            409
        );
    }

    try {
        await prisma.$transaction(async (tx) => {
           

            const currentOrder =
                await tx.order.findUnique({
                    where: {
                        id: orderId,
                    },

                    select: {
                        subtotal: true,
                        couponDiscount: true,
                        total: true,
                    },
                });

            if (!currentOrder) {
                throw new AppError(
                    "Order not found",
                    404
                );
            }

            let cancellationAmount =
                new Prisma.Decimal(0);


            for (const item of activeItems) {
                const quantity =
                    item.remainingQuantity;

                
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


                const updated =
                    await tx.orderItem.updateMany({
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
                            cancellationAmount,
                    },

                    subtotal: new Prisma.Decimal(0),

                    couponDiscount:
                        new Prisma.Decimal(0),

                    total: new Prisma.Decimal(0),
                },
            });
        });
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
                return getOrderByIdForUser(
                    orderId,
                    userId
                );
            }
        }

        throw err;
    }

    return getOrderByIdForUser(
        orderId,
        userId
    );
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
    const item =
        await prisma.orderItem.findFirst({
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
        throw new AppError(
            "Order item not found",
            404
        );
    }



    if (
        item.order.status !== "PENDING" &&
        item.order.status !== "CONFIRMED"
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

    try {
        return await prisma.$transaction(
            async (tx) => {
                // ------------------------------------------------
                // Read CURRENT order financial values.
                //
                // This must happen inside the transaction.
                // ------------------------------------------------

                const currentOrder =
                    await tx.order.findUnique({
                        where: {
                            id: orderId,
                        },

                        select: {
                            subtotal: true,
                            couponDiscount: true,
                            total: true,
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



                const couponDiscountPortion =
                    calculateCouponDiscountPortion(
                        currentOrder.subtotal,
                        currentOrder.couponDiscount,
                        cancellationAmount
                    );


                const netCancellationAmount =
                    cancellationAmount.sub(
                        couponDiscountPortion
                    );



                const remainingActive =
                    await tx.orderItem.count({
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

                            cancelledAmount: {
                                increment:
                                    cancellationAmount,
                            },

                            subtotal:
                                new Prisma.Decimal(0),

                            couponDiscount:
                                new Prisma.Decimal(0),

                            total:
                                new Prisma.Decimal(0),
                        },
                    });
                } else {


                    await tx.order.update({
                        where: {
                            id: orderId,
                        },

                        data: {
                            cancelledAmount: {
                                increment:
                                    cancellationAmount,
                            },

                            subtotal: {
                                decrement:
                                    cancellationAmount,
                            },

                            couponDiscount: {
                                decrement:
                                    couponDiscountPortion,
                            },

                            total: {
                                decrement:
                                    netCancellationAmount,
                            },
                        },
                    });
                }


                return tx.orderItem.findUniqueOrThrow({
                    where: {
                        id: itemId,
                    },

                    select:
                        orderItemMutationSelect,
                });
            }
        );
    } catch (err) {


        if (isIdempotencyConflict(err)) {
            return prisma.orderItem.findUniqueOrThrow({
                where: {
                    id: itemId,
                },

                select:
                    orderItemMutationSelect,
            });
        }

        throw err;
    }
}



export async function returnOrderItem(
    orderId: number,
    itemId: number,
    userId: number,
    quantity: number,
    reason: string,
    idempotencyKey: string
) {
    const item =
        await prisma.orderItem.findFirst({
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
        throw new AppError(
            "Order item not found",
            404
        );
    }



    if (
        item.order.status !== "DELIVERED"
    ) {
        throw new AppError(
            "Only items on delivered orders can be returned",
            400
        );
    }

    if (
        quantity >
        item.remainingQuantity
    ) {
        throw new AppError(
            `Cannot return ${quantity} unit(s); only ${item.remainingQuantity} remain eligible`,
            409
        );
    }

    try {
        return await prisma.$transaction(
            async (tx) => {

                await tx.orderItemAction.create({
                    data: {
                        orderItemId: itemId,
                        type: "RETURN",
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

                return tx.orderItem.findUniqueOrThrow({
                    where: {
                        id: itemId,
                    },

                    select:
                        orderItemMutationSelect,
                });
            }
        );
    } catch (err) {
        if (isIdempotencyConflict(err)) {
            return prisma.orderItem.findUniqueOrThrow({
                where: {
                    id: itemId,
                },

                select:
                    orderItemMutationSelect,
            });
        }

        throw err;
    }
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
        });

    if (!order) {
        throw new AppError(
            "Order not found",
            404
        );
    }


    if (
        order.paymentStatus === "PAID"
    ) {
        return order;
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


    const secret =
        process.env.RAZORPAY_KEY_SECRET;

    if (!secret) {
        throw new AppError(
            "Payment configuration error",
            500
        );
    }


    const generatedSignature =
        crypto
            .createHmac(
                "sha256",
                secret
            )
            .update(
                `${order.razorpayOrderId}|${razorpayPaymentId}`
            )
            .digest("hex");

    const generatedBuffer =
        Buffer.from(
            generatedSignature,
            "utf8"
        );

    const receivedBuffer =
        Buffer.from(
            razorpaySignature,
            "utf8"
        );

    if (
        generatedBuffer.length !==
            receivedBuffer.length ||
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

    const updatedOrder =
        await prisma.$transaction(
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


                if (
                    currentOrder.paymentStatus ===
                    "PAID"
                ) {
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