import crypto from "crypto";

import prisma from "../config/prisma";
import razorpay from "../config/razorpay";
import AppError from "../errors/AppError";

import { Prisma } from "../../generated/prisma/client";

import {
  confirmOrderPayment,
  toPaise,
} from "./customer/checkout.service";

interface WebhookPaymentEntity {
  id: string;
  order_id: string | null;
  status: string;
  amount: number | string;
  currency: string;
}

interface WebhookRefundEntity {
  id: string;
  payment_id: string;
  status: string;
}

interface WebhookEvent {
  event?: string;
  payload?: {
    payment?: {
      entity?: WebhookPaymentEntity;
    };
    refund?: {
      entity?: WebhookRefundEntity;
    };
  };
}

export const verifyWebhookSignature = (
  rawBody: Buffer,
  signature: string | undefined
): boolean => {
  const secret =
    process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    throw new AppError(
      "Razorpay webhook secret is not configured",
      500
    );
  }

  if (!signature) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected);

  const receivedBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length ===
      receivedBuffer.length &&
    crypto.timingSafeEqual(
      expectedBuffer,
      receivedBuffer
    )
  );
};

const refundCapturedPaymentForLostOrder = async (
  orderId: number,
  payment: WebhookPaymentEntity
) => {
  const idempotencyKey = `webhook-orphan:${payment.id}`;

  const amountInPaise = Number(payment.amount);

  let refundRow;

  try {
    refundRow = await prisma.refund.create({
      data: {
        orderId,

        amount: new Prisma.Decimal(amountInPaise)
          .div(100)
          .toDecimalPlaces(2),

        razorpayPaymentId: payment.id,

        reason:
          "Payment captured after the order was no longer confirmable",

        idempotencyKey,
      },
    });
  } catch (error) {
    if (
      error instanceof
        Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }

    throw error;
  }

  try {
    const refund = await razorpay.payments.refund(
      payment.id,
      {
        amount: amountInPaise,

        speed: "normal",

        receipt: idempotencyKey,

        notes: {
          orderId: String(orderId),
        },
      }
    );

    await prisma.refund.update({
      where: {
        id: refundRow.id,
      },

      data: {
        status: "PROCESSED",

        razorpayRefundId: refund.id,
      },
    });
  } catch (error) {
    const failureReason =
      error instanceof Error
        ? error.message
        : "Unknown refund error";

    await prisma.refund.update({
      where: {
        id: refundRow.id,
      },

      data: {
        status: "FAILED",

        failureReason:
          failureReason.slice(0, 500),
      },
    });

    console.error(
      `[razorpay-webhook] could not refund orphaned payment ${payment.id} for order ${orderId}`,
      error
    );
  }
};

const handleCapturedPayment = async (
  payment: WebhookPaymentEntity
) => {
  if (!payment.order_id) {
    return;
  }

  const order = await prisma.order.findFirst({
    where: {
      razorpayOrderId: payment.order_id,
    },

    select: {
      id: true,
      status: true,
      paymentStatus: true,
      total: true,
    },
  });

  if (!order) {
    console.error(
      `[razorpay-webhook] captured payment ${payment.id} has no matching order`
    );

    return;
  }

  if (order.paymentStatus === "PAID") {
    return;
  }

  if (
    Number(payment.amount) <
    toPaise(order.total)
  ) {
    console.error(
      `[razorpay-webhook] payment ${payment.id} is short of the total for order ${order.id}`
    );

    return;
  }

  if (
    order.status !== "PENDING" ||
    order.paymentStatus !== "PENDING"
  ) {
    await refundCapturedPaymentForLostOrder(
      order.id,
      payment
    );

    return;
  }

  try {
    await confirmOrderPayment({
      orderId: order.id,

      razorpayPaymentId: payment.id,

      enforceExpiry: false,
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      error.statusCode === 409
    ) {
      await refundCapturedPaymentForLostOrder(
        order.id,
        payment
      );

      return;
    }

    throw error;
  }
};

const handleRefundStatus = async (
  refund: WebhookRefundEntity,
  status: "PROCESSED" | "FAILED"
) => {
  const updated = await prisma.refund.updateMany({
    where: {
      razorpayRefundId: refund.id,
    },

    data: {
      status,
    },
  });

  if (updated.count === 0) {
    console.error(
      `[razorpay-webhook] refund ${refund.id} is not tracked locally`
    );
  }
};

export const handleRazorpayWebhook = async (
  rawBody: Buffer
): Promise<void> => {
  let event: WebhookEvent;

  try {
    event = JSON.parse(
      rawBody.toString("utf8")
    ) as WebhookEvent;
  } catch {
    throw new AppError(
      "Invalid webhook payload",
      400
    );
  }

  const payment = event.payload?.payment?.entity;

  const refund = event.payload?.refund?.entity;

  switch (event.event) {
    case "payment.captured":
    case "order.paid": {
      if (payment) {
        await handleCapturedPayment(payment);
      }

      return;
    }

    case "payment.failed": {
      if (payment) {
        console.error(
          `[razorpay-webhook] payment ${payment.id} failed for razorpay order ${payment.order_id}`
        );
      }

      return;
    }

    case "refund.processed": {
      if (refund) {
        await handleRefundStatus(
          refund,
          "PROCESSED"
        );
      }

      return;
    }

    case "refund.failed": {
      if (refund) {
        await handleRefundStatus(
          refund,
          "FAILED"
        );
      }

      return;
    }

    default:
      return;
  }
};
