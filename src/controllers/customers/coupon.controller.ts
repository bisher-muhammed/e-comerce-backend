
import {
  Request,
  Response,
} from "express";

import {
  getAvailableCoupons,
  validateCoupon,
  claimCoupon,
} from "../../services/customer/coupon.service";

import { validated } from "../../middlewares/validate.middleware";

import type {
  CouponCodeParams,
  ValidateCouponQuery,
} from "../../validations/customer/coupon.validation";


export const getAvailableCouponsController =
  async (
    req: Request,
    res: Response
  ) => {
    const userId = req.user!.id;

    const coupons =
      await getAvailableCoupons(userId);

    res.status(200).json({
      success: true,
      data: coupons,
    });
  };



export const validateCouponController =
  async (
    req: Request,
    res: Response
  ) => {
    const userId = req.user!.id;

    const { code } =
      validated<CouponCodeParams>(
        req,
        "params"
      );

    const { subtotal } =
      validated<ValidateCouponQuery>(
        req,
        "query"
      );

    const coupon =
      await validateCoupon(
        userId,
        code,
        subtotal
      );

    res.status(200).json({
      success: true,
      data: coupon,
    });
  };


export const claimCouponController =
  async (
    req: Request,
    res: Response
  ) => {
    const userId = req.user!.id;

    const { code } =
      validated<CouponCodeParams>(
        req,
        "params"
      );

    const claim =
      await claimCoupon(userId, code);

    res.status(201).json({
      success: true,
      message:
        "Coupon claimed successfully",
      data: claim,
    });
  };
