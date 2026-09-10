import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

import {
  type CreateCouponInput,
  type UpdateCouponInput,
  type ListCouponsInput,
} from "../../validations/admin/coupon.validation";

import { Prisma } from "../../../generated/prisma/client";

// ============================================================
// TYPES
// ============================================================

type CouponOrderBy =
  | "createdAt"
  | "updatedAt"
  | "name"
  | "code"
  | "startsOn"
  | "expiresOn"
  | "discountValue"
  | "minimumOrderAmount";

type CouponOrder = "asc" | "desc";

// ============================================================
// HELPERS
// ============================================================

const normalizeCouponCode = (code: string): string => {
  return code.replace(/\s+/g, "").toUpperCase();
};

// ============================================================
// CREATE COUPON
// ============================================================

export const createCoupon = async (
  data: CreateCouponInput
) => {
  const normalizedCode = normalizeCouponCode(data.code);

  // ----------------------------------------------------------
  // Check duplicate code
  // ----------------------------------------------------------

  const existingCoupon = await prisma.coupon.findUnique({
    where: {
      code: normalizedCode,
    },
    select: {
      id: true,
    },
  });

  if (existingCoupon) {
    throw new AppError(
      
      "Coupon code already exists", 409
    );
  }

  try {
    const coupon = await prisma.coupon.create({
      data: {
        name: data.name,
        code: normalizedCode,

        discountType: data.discountType,
        discountValue: data.discountValue,

        minimumOrderAmount:
          data.minimumOrderAmount,

        maximumDiscountAmount:
          data.maximumDiscountAmount ?? null,

        startsOn: data.startsOn,
        expiresOn: data.expiresOn,

        isActive: data.isActive,
      },
    });

    return coupon;
  } catch (error) {
    // --------------------------------------------------------
    // Database-level unique protection
    // --------------------------------------------------------

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        "Coupon code already exists",409
      );
    }

    throw error;
  }
};

// ============================================================
// LIST COUPONS
// ============================================================

export const listCoupons = async (
  data: ListCouponsInput
) => {
  const {
    page,
    limit,
    search,
    discountType,
    isActive,
    startDate,
    endDate,
  } = data;

  const skip = (page - 1) * limit;

  // ----------------------------------------------------------
  // WHERE
  // ----------------------------------------------------------

  const where: Prisma.CouponWhereInput = {};

  // Search name OR code
  if (search) {
    const normalizedSearch = search.trim();

    where.OR = [
      {
        name: {
          contains: normalizedSearch,
          mode: "insensitive",
        },
      },
      {
        code: {
          contains: normalizeCouponCode(
            normalizedSearch
          ),
          mode: "insensitive",
        },
      },
    ];
  }

  // Discount type filter
  if (discountType) {
    where.discountType = discountType;
  }

  // Active/inactive filter
  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  // ----------------------------------------------------------
  // DATE FILTER
  //
  // startDate/endDate here refer to coupon startsOn.
  // ----------------------------------------------------------

  if (startDate || endDate) {
    where.startsOn = {};

    if (startDate) {
      where.startsOn.gte = startDate;
    }

    if (endDate) {
      where.startsOn.lte = endDate;
    }
  }

  // ----------------------------------------------------------
  // ORDER BY
  // ----------------------------------------------------------

  const orderByField: CouponOrderBy =
    data.orderBy ?? "createdAt";

  const order: CouponOrder =
    data.order ?? "desc";

  const orderBy = {
    [orderByField]: order,
  } as Prisma.CouponOrderByWithRelationInput;

  // ----------------------------------------------------------
  // QUERY
  // ----------------------------------------------------------

  const [coupons, total] =
    await prisma.$transaction([
      prisma.coupon.findMany({
        where,

        skip,
        take: limit,

        orderBy,

        include: {
          _count: {
            select: {
              claims: true,
            },
          },
        },
      }),

      prisma.coupon.count({
        where,
      }),
    ]);

  const totalPages = Math.ceil(total / limit);

  return {
    coupons,

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

    filters: {
      search: search ?? null,
      discountType: discountType ?? null,
      isActive:
        isActive !== undefined
          ? isActive
          : null,

      startDate: startDate ?? null,
      endDate: endDate ?? null,

      orderBy: orderByField,
      order,
    },
  };
};

// ============================================================
// GET COUPON BY ID
// ============================================================

export const getCouponById = async (
  couponId: number
) => {
  const coupon = await prisma.coupon.findUnique({
    where: {
      id: couponId,
    },

    include: {
      _count: {
        select: {
          claims: true,
        },
      },
    },
  });

  if (!coupon) {
    throw new AppError(
      
      "Coupon not found",404
    );
  }

  return coupon;
};

// ============================================================
// UPDATE COUPON
// ============================================================

export const updateCoupon = async (
  couponId: number,
  data: UpdateCouponInput
) => {
  // ----------------------------------------------------------
  // Get existing coupon
  // ----------------------------------------------------------

  const existingCoupon =
    await prisma.coupon.findUnique({
      where: {
        id: couponId,
      },
    });

  if (!existingCoupon) {
    throw new AppError(
      
      "Coupon not found",
      404
    );
  }

  // ----------------------------------------------------------
  // Get claim count
  // ----------------------------------------------------------

  const claimCount =
    await prisma.couponClaim.count({
      where: {
        couponId,
      },
    });

  const hasClaims = claimCount > 0;

  // ----------------------------------------------------------
  // Normalize incoming code
  // ----------------------------------------------------------

  const normalizedCode =
    data.code !== undefined
      ? normalizeCouponCode(data.code)
      : undefined;

  // ----------------------------------------------------------
  // CODE CHANGE
  //
  // Code can be changed only when nobody has claimed it.
  // ----------------------------------------------------------

  if (
    normalizedCode !== undefined &&
    normalizedCode !== existingCoupon.code
  ) {
    if (hasClaims) {
      throw new AppError(
        
        "Coupon code cannot be changed after it has been claimed",
        400
      );
    }

    const duplicateCoupon =
      await prisma.coupon.findFirst({
        where: {
          code: normalizedCode,
          NOT: {
            id: couponId,
          },
        },

        select: {
          id: true,
        },
      });

    if (duplicateCoupon) {
      throw new AppError(
        
        "Coupon code already exists",
        409
      );
    }
  }


  if (hasClaims) {
    const financialFieldChanged =
      (data.discountType !== undefined &&
        data.discountType !==
          existingCoupon.discountType) ||

      (data.discountValue !== undefined &&
        Number(data.discountValue) !==
          Number(existingCoupon.discountValue)) ||

      (data.minimumOrderAmount !== undefined &&
        Number(data.minimumOrderAmount) !==
          Number(
            existingCoupon.minimumOrderAmount
          )) ||

      (data.maximumDiscountAmount !==
        undefined &&
        Number(
          data.maximumDiscountAmount ?? 0
        ) !==
          Number(
            existingCoupon.maximumDiscountAmount ??
              0
          ));

    if (financialFieldChanged) {
      throw new AppError(
        
        "Coupon discount rules cannot be changed after it has been claimed",400
      );
    }
  }


  const finalDiscountType =
    data.discountType ??
    existingCoupon.discountType;

  const finalDiscountValue =
    data.discountValue ??
    Number(existingCoupon.discountValue);

  const finalMaximumDiscountAmount =
    data.maximumDiscountAmount !== undefined
      ? data.maximumDiscountAmount
      : existingCoupon.maximumDiscountAmount !==
          null
        ? Number(
            existingCoupon.maximumDiscountAmount
          )
        : null;

  const finalStartsOn =
    data.startsOn ?? existingCoupon.startsOn;

  const finalExpiresOn =
    data.expiresOn ?? existingCoupon.expiresOn;

  // ----------------------------------------------------------
  // FINAL DATE VALIDATION
  // ----------------------------------------------------------

  if (finalStartsOn > finalExpiresOn) {
    throw new AppError(
     
      "Start date must be before or equal to expiry date",400
    );
  }


  if (
    finalDiscountType === "PERCENTAGE" &&
    finalDiscountValue > 100
  ) {
    throw new AppError(
     
      "Percentage discount cannot exceed 100%",400
    );
  }

  if (
    finalDiscountType === "FIXED" &&
    finalMaximumDiscountAmount !== null
  ) {
    throw new AppError(
      
      "Maximum discount amount can only be used with percentage coupons", 400
    );
  }

  // ----------------------------------------------------------
  // UPDATE DATA
  // ----------------------------------------------------------

  const updateData: Prisma.CouponUpdateInput = {};

  if (data.name !== undefined) {
    updateData.name = data.name;
  }

  if (normalizedCode !== undefined) {
    updateData.code = normalizedCode;
  }

  if (data.discountType !== undefined) {
    updateData.discountType =
      data.discountType;
  }

  if (data.discountValue !== undefined) {
    updateData.discountValue =
      data.discountValue;
  }

  if (
    data.minimumOrderAmount !== undefined
  ) {
    updateData.minimumOrderAmount =
      data.minimumOrderAmount;
  }

  if (
    data.maximumDiscountAmount !== undefined
  ) {
    updateData.maximumDiscountAmount =
      data.maximumDiscountAmount;
  }

  if (data.startsOn !== undefined) {
    updateData.startsOn = data.startsOn;
  }

  if (data.expiresOn !== undefined) {
    updateData.expiresOn = data.expiresOn;
  }

  if (data.isActive !== undefined) {
    updateData.isActive = data.isActive;
  }

  // ----------------------------------------------------------
  // Nothing to update
  // ----------------------------------------------------------

  if (Object.keys(updateData).length === 0) {
    return existingCoupon;
  }

  // ----------------------------------------------------------
  // UPDATE
  // ----------------------------------------------------------

  try {
    const updatedCoupon =
      await prisma.coupon.update({
        where: {
          id: couponId,
        },

        data: updateData,
      });

    return updatedCoupon;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        
        "Coupon code already exists",409
      );
    }

    throw error;
  }
};

// ============================================================
// UPDATE COUPON STATUS
// ============================================================

export const updateCouponStatus = async (
  couponId: number,
  isActive: boolean
) => {
  const coupon =
    await prisma.coupon.findUnique({
      where: {
        id: couponId,
      },

      select: {
        id: true,
      },
    });

  if (!coupon) {
    throw new AppError(
      
      "Coupon not found",
      404
    );
  }

  return prisma.coupon.update({
    where: {
      id: couponId,
    },

    data: {
      isActive,
    },
  });
};

// ============================================================
// DELETE COUPON
// ============================================================

export const deleteCoupon = async (
  couponId: number
) => {
  const coupon =
    await prisma.coupon.findUnique({
      where: {
        id: couponId,
      },

      select: {
        id: true,
      },
    });

  if (!coupon) {
    throw new AppError(
      
      "Coupon not found"
      ,404,
    );
  }

  // ----------------------------------------------------------
  // Do not delete coupons that have been claimed.
  //
  // A claim represents historical/customer state.
  // Admin should deactivate the coupon instead.
  // ----------------------------------------------------------

  const claimCount =
    await prisma.couponClaim.count({
      where: {
        couponId,
      },
    });

  if (claimCount > 0) {
    throw new AppError(
      
      "Coupon cannot be deleted after it has been claimed. Deactivate it instead.",
      400
    );
  }

  try {
    await prisma.coupon.delete({
      where: {
        id: couponId,
      },
    });

    return {
      message: "Coupon deleted successfully",
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
    ) {
      if (error.code === "P2025") {
        throw new AppError(
         
          "Coupon not found", 404
          
        );
      }
    }

    throw error;
  }
};
