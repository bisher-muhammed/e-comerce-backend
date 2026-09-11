import prisma from "../../config/prisma";

import AppError from "../../errors/AppError";

import { Prisma } from "../../../generated/prisma/client";


const normalizeCouponCode = (code: string): string => {
  return code
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
};

const getTodayStart = (): Date => {
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
};

const isCouponCurrentlyValid = (
  coupon: {
    isActive: boolean;
    startsOn: Date;
    expiresOn: Date;
  },
  today: Date
): boolean => {
  return (
    coupon.isActive &&
    today >= coupon.startsOn &&
    today <= coupon.expiresOn
  );
};

const isCouponExhausted = (coupon: {
  usageLimit: number | null;
  usedCount: number;
}): boolean => {
  return (
    coupon.usageLimit !== null &&
    coupon.usedCount >= coupon.usageLimit
  );
};

const calculateDiscount = (
  coupon: {
    discountType: "PERCENTAGE" | "FIXED";
    discountValue: Prisma.Decimal;
    minimumOrderAmount: Prisma.Decimal;
    maximumDiscountAmount: Prisma.Decimal | null;
  },
  subtotal: number
) => {
  const minimumOrderAmount =
    Number(coupon.minimumOrderAmount);

  const discountValue =
    Number(coupon.discountValue);

  const maximumDiscountAmount =
    coupon.maximumDiscountAmount !== null
      ? Number(coupon.maximumDiscountAmount)
      : null;



  if (subtotal < minimumOrderAmount) {
    return {
      eligible: false,
      discountAmount: 0,
      minimumOrderAmount,
      message: `Minimum order amount is ₹${minimumOrderAmount.toFixed(
        2
      )}`,
    };
  }



  if (coupon.discountType === "PERCENTAGE") {
    let discountAmount =
      (subtotal * discountValue) / 100;

    // Apply maximum discount limit
    if (maximumDiscountAmount !== null) {
      discountAmount = Math.min(
        discountAmount,
        maximumDiscountAmount
      );
    }

    // Never discount more than subtotal
    discountAmount = Math.min(
      discountAmount,
      subtotal
    );

    return {
      eligible: true,
      discountAmount,
      minimumOrderAmount,
      message: "Coupon applied successfully",
    };
  }



  const discountAmount = Math.min(
    discountValue,
    subtotal
  );

  return {
    eligible: true,
    discountAmount,
    minimumOrderAmount,
    message: "Coupon applied successfully",
  };
};



export const getAvailableCoupons = async (
  userId: number
) => {
  const today = getTodayStart();

  const coupons =
    await prisma.coupon.findMany({
      where: {
        isActive: true,

        startsOn: {
          lte: today,
        },

        expiresOn: {
          gte: today,
        },
      },

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        name: true,
        code: true,
        discountType: true,
        discountValue: true,
        minimumOrderAmount: true,
        maximumDiscountAmount: true,
        startsOn: true,
        expiresOn: true,
        isActive: true,
        usageLimit: true,
        usedCount: true,

        claims: {
          where: {
            userId,
          },

          select: {
            id: true,
            claimedAt: true,
            usedAt: true,
          },

          take: 1,
        },
      },
    });

  return coupons.map((coupon) => {
    const claim = coupon.claims[0] ?? null;

    return {
      id: coupon.id,

      name: coupon.name,

      code: coupon.code,

      discountType: coupon.discountType,

      discountValue:
        coupon.discountValue,

      minimumOrderAmount:
        coupon.minimumOrderAmount,

      maximumDiscountAmount:
        coupon.maximumDiscountAmount,

      startsOn: coupon.startsOn,

      expiresOn: coupon.expiresOn,

      isActive: coupon.isActive,

      usageLimit: coupon.usageLimit,

      remainingUses:
        coupon.usageLimit !== null
          ? Math.max(
              coupon.usageLimit -
                coupon.usedCount,
              0
            )
          : null,

      isExhausted:
        isCouponExhausted(coupon),

      isClaimed: claim !== null,

      claim: claim
        ? {
            id: claim.id,
            claimedAt: claim.claimedAt,
            usedAt: claim.usedAt,
          }
        : null,
    };
  });
};


export const validateCoupon = async (
  userId: number,
  code: string,
  subtotal: number
) => {
  const normalizedCode =
    normalizeCouponCode(code);



  const coupon =
    await prisma.coupon.findUnique({
      where: {
        code: normalizedCode,
      },

      select: {
        id: true,
        name: true,
        code: true,
        discountType: true,
        discountValue: true,
        minimumOrderAmount: true,
        maximumDiscountAmount: true,
        startsOn: true,
        expiresOn: true,
        isActive: true,
        usageLimit: true,
        usedCount: true,
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



  const existingClaim =
    await prisma.couponClaim.findUnique({
      where: {
        couponId_userId: {
          couponId: coupon.id,
          userId,
        },
      },

      select: {
        id: true,
        claimedAt: true,
        usedAt: true,
      },
    });



  if (!existingClaim) {
    throw new AppError(
      "You must claim this coupon before using it",
      400
    );
  }


  if (existingClaim.usedAt !== null) {
    throw new AppError(
      "You have already used this coupon",
      400
    );
  }


  if (isCouponExhausted(coupon)) {
    throw new AppError(
      "This coupon has reached its usage limit",
      409
    );
  }


  const calculation =
    calculateDiscount(
      coupon,
      subtotal
    );

  if (!calculation.eligible) {
    throw new AppError(
      calculation.message,
      400
    );
  }


  return {
    coupon: {
      id: coupon.id,

      name: coupon.name,

      code: coupon.code,

      discountType:
        coupon.discountType,

      discountValue:
        coupon.discountValue,

      minimumOrderAmount:
        coupon.minimumOrderAmount,

      maximumDiscountAmount:
        coupon.maximumDiscountAmount,

      startsOn: coupon.startsOn,

      expiresOn: coupon.expiresOn,
    },

    subtotal,

    discountAmount:
      calculation.discountAmount,

    finalSubtotal:
      subtotal -
      calculation.discountAmount,
  };
};


export const claimCoupon = async (
  userId: number,
  code: string
) => {
  const normalizedCode =
    normalizeCouponCode(code);



  const coupon =
    await prisma.coupon.findUnique({
      where: {
        code: normalizedCode,
      },

      select: {
        id: true,
        name: true,
        code: true,
        discountType: true,
        discountValue: true,
        minimumOrderAmount: true,
        maximumDiscountAmount: true,
        startsOn: true,
        expiresOn: true,
        isActive: true,
        usageLimit: true,
        usedCount: true,
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


  if (isCouponExhausted(coupon)) {
    throw new AppError(
      "This coupon has reached its usage limit",
      409
    );
  }



  try {
    const claim =
      await prisma.couponClaim.create({
        data: {
          couponId: coupon.id,
          userId,
        },

        select: {
          id: true,
          claimedAt: true,

          coupon: {
            select: {
              id: true,
              name: true,
              code: true,
              discountType: true,
              discountValue: true,
              minimumOrderAmount: true,
              maximumDiscountAmount: true,
              startsOn: true,
              expiresOn: true,
            },
          },
        },
      });

    return claim;
  } catch (error) {


    if (
      error instanceof
        Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        "You have already claimed this coupon",
        409
      );
    }

    throw error;
  }
};
