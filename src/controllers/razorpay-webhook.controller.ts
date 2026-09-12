import { Request, Response, NextFunction } from "express";

import {
  handleRazorpayWebhook,
  verifyWebhookSignature,
} from "../services/razorpay-webhook.service";

import AppError from "../errors/AppError";

export const razorpayWebhookController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      throw new AppError(
        "Invalid webhook payload",
        400
      );
    }

    const signature =
      req.header("x-razorpay-signature") ??
      undefined;

    if (
      !verifyWebhookSignature(rawBody, signature)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid webhook signature",
      });
    }

    await handleRazorpayWebhook(rawBody);

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
};
