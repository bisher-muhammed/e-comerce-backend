import prisma from "../config/prisma";

import AppError from "../errors/AppError";

type TransactionClient = Parameters<
    Parameters<typeof prisma.$transaction>[0]
>[0];

export async function consumeCouponClaim(
    tx: TransactionClient,
    params: {
        claimId: number;
        couponId: number;
        orderId: number;
    }
): Promise<void> {
    const claimed =
        await tx.couponClaim.updateMany({
            where: {
                id: params.claimId,

                usedAt: null,
            },

            data: {
                usedAt: new Date(),

                orderId: params.orderId,
            },
        });

    if (claimed.count === 0) {
        throw new AppError(
            "You have already used this coupon",
            409
        );
    }

    const consumed =
        await tx.coupon.updateMany({
            where: {
                id: params.couponId,

                OR: [
                    {
                        usageLimit: null,
                    },
                    {
                        usedCount: {
                            lt: prisma.coupon
                                .fields
                                .usageLimit,
                        },
                    },
                ],
            },

            data: {
                usedCount: {
                    increment: 1,
                },
            },
        });

    if (consumed.count === 0) {
        throw new AppError(
            "This coupon has reached its usage limit",
            409
        );
    }
}

export async function releaseCouponClaimForOrder(
    tx: TransactionClient,
    orderId: number
): Promise<boolean> {
    const claim =
        await tx.couponClaim.findFirst({
            where: {
                orderId,

                usedAt: {
                    not: null,
                },
            },

            select: {
                id: true,
                couponId: true,
            },
        });

    if (!claim) {
        return false;
    }

    const released =
        await tx.couponClaim.updateMany({
            where: {
                id: claim.id,

                usedAt: {
                    not: null,
                },
            },

            data: {
                usedAt: null,

                orderId: null,
            },
        });

    if (released.count === 0) {
        return false;
    }

    await tx.coupon.updateMany({
        where: {
            id: claim.couponId,

            usedCount: {
                gt: 0,
            },
        },

        data: {
            usedCount: {
                decrement: 1,
            },
        },
    });

    return true;
}
