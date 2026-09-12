import { Request, Response, NextFunction } from "express";

import { validated } from "../../middlewares/validate.middleware";

import type {
  CouponIdParam,
  CreateCouponInput,
  UpdateCouponInput,
  UpdateCouponStatusInput,
  ListCouponsInput,
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
    const coupon = await createCoupon(
      validated<CreateCouponInput>(req, "body")
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
    const result = await listCoupons(
      validated<ListCouponsInput>(req, "query")
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
    const { id } = validated<CouponIdParam>(
      req,
      "params"
    );

    const coupon = await getCouponById(id);

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
    const { id } = validated<CouponIdParam>(
      req,
      "params"
    );

    const data = validated<UpdateCouponInput>(
      req,
      "body"
    );

    // --------------------------------------------------------
    // Prevent empty PATCH
    // --------------------------------------------------------

    if (Object.keys(data).length === 0) {
      throw new AppError(

        "At least one field is required to update the coupon",400
      );
    }

    const coupon = await updateCoupon(id, data);

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
      const { id } = validated<CouponIdParam>(
        req,
        "params"
      );

      const { isActive } =
        validated<UpdateCouponStatusInput>(
          req,
          "body"
        );

      const coupon =
        await updateCouponStatus(
          id,
          isActive
        );

      return res.status(200).json({
        success: true,
        message: isActive
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
    const { id } = validated<CouponIdParam>(
      req,
      "params"
    );

    const result = await deleteCoupon(id);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};
