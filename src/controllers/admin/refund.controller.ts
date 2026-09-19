import { Request, Response } from "express";

import { validated } from "../../middlewares/validate.middleware";
import type {
  ListRefundsQuery,
  RefundIdParam,
  RetryRefundBody,
} from "../../validations/admin/refund.validation";
import * as refundService from "../../services/refund.service";
import type { RefundOutcome } from "../../services/refund.service";
import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

const respondWithOutcome = (res: Response, refund: RefundOutcome) =>
  res.status(refund.status === "FAILED" ? 502 : 200).json({
    success: refund.status !== "FAILED",
    data: { refund },
  });

const requireRefund = async (refundId: number) => {
  const exists = await prisma.refund.findUnique({
    where: { id: refundId },
    select: { id: true },
  });

  if (!exists) {
    throw new AppError("Refund not found", 404);
  }
};

export const listRefunds = async (req: Request, res: Response) => {
  const query = validated<ListRefundsQuery>(req, "query");

  res.status(200).json({
    success: true,
    ...(await refundService.listRefunds(query)),
  });
};

export const retryRefund = async (req: Request, res: Response) => {
  const { refundId } = validated<RefundIdParam>(req, "params");
  const { idempotencyKey } = validated<RetryRefundBody>(req, "body");

  await requireRefund(refundId);

  respondWithOutcome(
    res,
    await refundService.retryRefund(refundId, idempotencyKey)
  );
};

export const reconcileRefund = async (req: Request, res: Response) => {
  const { refundId } = validated<RefundIdParam>(req, "params");

  await requireRefund(refundId);

  try {
    respondWithOutcome(res, await refundService.reconcileRefund(refundId));
  } catch {
    throw new AppError(
      "Could not reach Razorpay to reconcile this refund. Please try again.",
      502
    );
  }
};
