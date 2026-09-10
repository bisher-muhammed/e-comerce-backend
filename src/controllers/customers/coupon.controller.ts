
import {
  Request,
  Response,
} from "express";

import {
  getAvailableCoupons,
  validateCoupon,
  claimCoupon,
} from "../../services/customer/coupon.service";

import {
  couponCodeParamsSchema,
  validateCouponSchema,
  claimCouponSchema,
} from "../../validations/customer/coupon.validation";

import AppError from "../../errors/AppError";


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

    const parsedParams =
      couponCodeParamsSchema.safeParse(
        req.params
      );

    if (!parsedParams.success) {
      throw new AppError(
        parsedParams.error.issues[0]
          ?.message ??
          "Invalid coupon code",
        400
      );
    }

    const parsedQuery =
      validateCouponSchema.safeParse({
        code: parsedParams.data.code,
        subtotal: req.query.subtotal,
      });

    if (!parsedQuery.success) {
      throw new AppError(
        parsedQuery.error.issues[0]
          ?.message ??
          "Invalid coupon validation data",
        400
      );
    }

    const coupon =
      await validateCoupon(
        userId,
        parsedQuery.data.code,
        parsedQuery.data.subtotal
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


    const parsedParams =
      couponCodeParamsSchema.safeParse(
        req.params
      );

    if (!parsedParams.success) {
      throw new AppError(
        parsedParams.error.issues[0]
          ?.message ??
          "Invalid coupon code",
        400
      );
    }



    const parsedBody =
      claimCouponSchema.safeParse(
        req.body ?? {}
      );

    if (!parsedBody.success) {
      throw new AppError(
        parsedBody.error.issues[0]
          ?.message ??
          "Invalid coupon claim request",
        400
      );
    }



    const claim =
      await claimCoupon(
        userId,
        parsedParams.data.code
      );

    res.status(201).json({
      success: true,
      message:
        "Coupon claimed successfully",
      data: claim,
    });
  };

