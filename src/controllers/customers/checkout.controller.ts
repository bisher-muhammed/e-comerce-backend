import {
  Request,
  Response,
} from "express";

import {
  createCheckout,
  verifyPayment,
} from "../../services/customer/checkout.service";

import { validated } from "../../middlewares/validate.middleware";

import type {
  CheckoutFormData,
  VerifyPaymentFormData,
} from "../../validations/customer/checkout.validation";


export const createCheckoutController =
  async (
    req: Request,
    res: Response
  ) => {
    const userId =
      req.user!.id;

    const data =
      validated<CheckoutFormData>(
        req,
        "body"
      );

    const result =
      await createCheckout(
        userId,

        data.addressId,

        data.contactEmail,

        data.contactPhone,

        data.paymentMethod,

        data.idempotencyKey,


        data.couponCode
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

    const data =
      validated<VerifyPaymentFormData>(
        req,
        "body"
      );

    const order =
      await verifyPayment(
        userId,

        data.razorpay_order_id,

        data.razorpay_payment_id,

        data.razorpay_signature
      );

    res.status(200).json({
      success: true,
      data: order,
    });
  };
