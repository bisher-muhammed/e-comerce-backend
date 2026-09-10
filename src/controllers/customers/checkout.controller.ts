import {
  Request,
  Response,
} from "express";

import {
  createCheckout,
  verifyPayment,
} from "../../services/customer/checkout.service";

import {
  checkoutSchema,
  verifyPaymentSchema,
} from "../../validations/customer/checkout.validation";

import AppError from "../../errors/AppError";


export const createCheckoutController =
  async (
    req: Request,
    res: Response
  ) => {
    const userId =
      req.user!.id;

    const parsed =
      checkoutSchema.safeParse(
        req.body
      );

    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]
          .message,
        400
      );
    }

    const result =
      await createCheckout(
        userId,

        parsed.data.addressId,

        parsed.data.contactEmail,

        parsed.data.contactPhone,

        parsed.data.paymentMethod,

        parsed.data.idempotencyKey,


        parsed.data.couponCode
      );

    res.status(201).json({
      success: true,
      data: result,
    });
  };


export const verifyPaymentController =
  async (
    req: Request,
    res: Response
  ) => {
    const userId =
      req.user!.id;

    const parsed =
      verifyPaymentSchema.safeParse(
        req.body
      );

    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]
          .message,
        400
      );
    }

    const order =
      await verifyPayment(
        userId,

        parsed.data
          .razorpay_order_id,

        parsed.data
          .razorpay_payment_id,

        parsed.data
          .razorpay_signature
      );

    res.status(200).json({
      success: true,
      data: order,
    });
  };