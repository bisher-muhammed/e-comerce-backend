import crypto from "crypto";

import prisma from "../config/prisma";
import AppError from "../errors/AppError";


import {
  confirmOrderPayment,
  toPaise,
} from "./customer/checkout.service";

import {
  issueOrphanPaymentRefund,
  markRefundFailed,
  markRefundProcessed,
} from "./refund.service";

import { logError } from "../utils/logger.util";

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
  notes?: Record<string, unknown> | unknown[];
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
  const outcome = await issueOrphanPaymentRefund({
    orderId,
    razorpayPaymentId: payment.id,
    amountInPaise: Number(payment.amount),
    idempotencyKey: `webhook-orphan:${payment.id}`,
    reason:
      "Payment captured after the order was no longer confirmable",
  });

  if (outcome.status === "FAILED" || outcome.status === "PENDING") {
    logError(
      "razorpay_webhook.orphan_refund_not_settled",
      new Error(`Orphan refund ${outcome.status}`),
      { orderId, refundId: outcome.refundId, alert: true }
    );
  }
};

/**
 * An order that an admin moved forward before the payment arrived (only
 * possible for legacy data now that M1 blocks it) keeps the money: record
 * the payment, never refund it, and alert so someone checks the order.
 */
const recordLatePayment = async (
  orderId: number,
  payment: WebhookPaymentEntity
) => {
  const recorded = await prisma.order.updateMany({
    where: {
      id: orderId,
      paymentStatus: { not: "PAID" },
      status: { in: ["CONFIRMED", "SHIPPED", "DELIVERED"] },
    },
    data: {
      paymentStatus: "PAID",
      razorpayPaymentId: payment.id,
    },
  });

  if (recorded.count === 1) {
    logError(
      "razorpay_webhook.late_payment_recorded",
      new Error("Payment captured after the order was moved forward unpaid"),
      { orderId, razorpayPaymentId: payment.id, alert: true }
    );
  }

  return recorded.count === 1;
};

const handleCapturedPayment = async (
  payment: WebhookPaymentEntity
) => {
  if (!payment.order_id) {
    return;
  }

  const findOrder = () =>
    prisma.order.findFirst({
      where: {
        razorpayOrderId: payment.order_id!,
      },

      select: {
        id: true,
        status: true,
        paymentStatus: true,
        razorpayPaymentId: true,
        total: true,
      },
    });

  const order = await findOrder();

  if (!order) {
    logError(
      "razorpay_webhook.unmatched_payment",
      new Error(`Captured payment has no matching order`),
      { razorpayPaymentId: payment.id, alert: true }
    );

    return;
  }

  if (order.paymentStatus === "PAID") {
    // A second, different payment for the same order is money we must
    // give back; the same payment again is just a duplicate event.
    if (
      order.razorpayPaymentId &&
      order.razorpayPaymentId !== payment.id
    ) {
      await refundCapturedPaymentForLostOrder(order.id, payment);
    }

    return;
  }

  if (
    Number(payment.amount) <
    toPaise(order.total)
  ) {
    logError(
      "razorpay_webhook.short_payment",
      new Error("Captured amount is below the order total"),
      { orderId: order.id, razorpayPaymentId: payment.id, alert: true }
    );

    return;
  }

  if (order.status === "CANCELLED") {
    await refundCapturedPaymentForLostOrder(order.id, payment);

    return;
  }

  if (order.status !== "PENDING") {
    await recordLatePayment(order.id, payment);

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
      !(error instanceof AppError) ||
      error.statusCode !== 409
    ) {
      throw error;
    }

    // Lost a race: decide again on the order's current state.
    const current = await findOrder();

    if (current?.status === "CANCELLED") {
      await refundCapturedPaymentForLostOrder(order.id, payment);
    } else if (current && current.paymentStatus !== "PAID") {
      await recordLatePayment(order.id, payment);
    }
  }
};

const handleRefundStatus = async (
  refund: WebhookRefundEntity,
  status: "PROCESSED" | "FAILED"
) => {
  const notes =
    refund.notes && !Array.isArray(refund.notes) ? refund.notes : {};

  const noteRefundId = Number(notes.refundId);

  const row = await prisma.refund.findFirst({
    where: {
      OR: [
        { razorpayRefundId: refund.id },
        ...(Number.isInteger(noteRefundId) && noteRefundId > 0
          ? [{ id: noteRefundId, razorpayPaymentId: refund.payment_id }]
          : []),
      ],
    },
    select: { id: true, orderId: true, status: true },
  });

  if (!row) {
    logError(
      "razorpay_webhook.untracked_refund",
      new Error(`Refund ${refund.id} is not tracked locally`),
      { razorpayRefundId: refund.id, alert: true }
    );

    return;
  }

  // Only PENDING rows move; PROCESSED and FAILED are terminal, so a
  // late or out-of-order event cannot rewrite history.
  const moved =
    status === "PROCESSED"
      ? await markRefundProcessed(row.id, refund.id)
      : await markRefundFailed(
          row.id,
          "Razorpay reported the refund as failed",
          refund.id
        );

  if (status === "FAILED" && moved) {
    logError(
      "refund.failed",
      new Error("Razorpay reported the refund as failed"),
      { orderId: row.orderId, refundId: row.id, alert: true }
    );
  }

  if (!moved && row.status !== status) {
    logError(
      "razorpay_webhook.refund_state_conflict",
      new Error(
        `Refund ${row.id} is ${row.status} but Razorpay sent ${status}`
      ),
      { orderId: row.orderId, refundId: row.id, alert: true }
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
