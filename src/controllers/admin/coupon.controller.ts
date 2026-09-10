import { Request, Response, NextFunction } from "express";

import {
  couponIdSchema,
  createCouponSchema,
  updateCouponSchema,
  updateCouponStatusSchema,
  listCouponsSchema,
} from "../../validations/admin/coupon.validation";

import {
  createCoupon,
  listCoupons,
  getCouponById,
  updateCoupon,
  updateCouponStatus,
  deleteCoupon,
} from "../../services/admin/coupon.service";

import AppError from "../../errors/AppError";

// ============================================================
// CREATE COUPON
// ============================================================

export const createCouponController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const parsed = createCouponSchema.safeParse(
      req.body
    );

    if (!parsed.success) {
      throw new AppError(
        
        parsed.error.issues[0]?.message ??
          "Invalid coupon data",400
      );
    }

    const coupon = await createCoupon(
      parsed.data
    );

    return res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      data: coupon,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// LIST COUPONS
// ============================================================

export const listCouponsController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const parsed = listCouponsSchema.safeParse(
      req.query
    );

    if (!parsed.success) {
      throw new AppError(
        
        parsed.error.issues[0]?.message ??
          "Invalid coupon filters",
          400,
      );
    }

    const result = await listCoupons(
      parsed.data
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// GET COUPON BY ID
// ============================================================

export const getCouponByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const parsed = couponIdSchema.safeParse(
      req.params
    );

    if (!parsed.success) {
      throw new AppError(
        
        "Invalid coupon ID",400
      );
    }

    const coupon = await getCouponById(
      parsed.data.id
    );

    return res.status(200).json({
      success: true,
      data: coupon,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// UPDATE COUPON
// ============================================================

export const updateCouponController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // --------------------------------------------------------
    // Validate ID
    // --------------------------------------------------------

    const parsedParams =
      couponIdSchema.safeParse(req.params);

    if (!parsedParams.success) {
      throw new AppError(
        
        "Invalid coupon ID",400
      );
    }

    // --------------------------------------------------------
    // Validate body
    // --------------------------------------------------------

    const parsedBody =
      updateCouponSchema.safeParse(req.body);

    if (!parsedBody.success) {
      throw new AppError(
        
        parsedBody.error.issues[0]?.message ??
          "Invalid coupon data",400
      );
    }

    // --------------------------------------------------------
    // Prevent empty PATCH
    // --------------------------------------------------------

    if (
      Object.keys(parsedBody.data).length === 0
    ) {
      throw new AppError(
        
        "At least one field is required to update the coupon",400
      );
    }

    const coupon = await updateCoupon(
      parsedParams.data.id,
      parsedBody.data
    );

    return res.status(200).json({
      success: true,
      message: "Coupon updated successfully",
      data: coupon,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// UPDATE COUPON STATUS
// ============================================================

export const updateCouponStatusController =
  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      // ------------------------------------------------------
      // Validate ID
      // ------------------------------------------------------

      const parsedParams =
        couponIdSchema.safeParse(req.params);

      if (!parsedParams.success) {
        throw new AppError(
          
          "Invalid coupon ID",400
        );
      }

      // ------------------------------------------------------
      // Validate body
      // ------------------------------------------------------

      const parsedBody =
        updateCouponStatusSchema.safeParse(
          req.body
        );

      if (!parsedBody.success) {
        throw new AppError(
          
          parsedBody.error.issues[0]?.message ??
            "Invalid coupon status",
            400
        );
      }

      const coupon =
        await updateCouponStatus(
          parsedParams.data.id,
          parsedBody.data.isActive
        );

      return res.status(200).json({
        success: true,
        message: parsedBody.data.isActive
          ? "Coupon activated successfully"
          : "Coupon deactivated successfully",
        data: coupon,
      });
    } catch (error) {
      next(error);
    }
  };

// ============================================================
// DELETE COUPON
// ============================================================

export const deleteCouponController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const parsed = couponIdSchema.safeParse(
      req.params
    );

    if (!parsed.success) {
      throw new AppError(
        
        "Invalid coupon ID",
        400
      );
    }

    const result = await deleteCoupon(
      parsed.data.id
    );

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};
