import { Request, Response } from "express";

import { validated } from "../../middlewares/validate.middleware";
import type {
  ListReturnsQuery,
  ManualRefundBody,
  RejectReturnBody,
  ReturnIdParam,
  ReturnNoteBody,
} from "../../validations/admin/return.validation";
import * as returnService from "../../services/return.service";

export const listReturns = async (req: Request, res: Response) => {
  const query = validated<ListReturnsQuery>(req, "query");

  res.status(200).json({
    success: true,
    ...(await returnService.listReturns(query)),
  });
};

export const approveReturn = async (req: Request, res: Response) => {
  const { returnId } = validated<ReturnIdParam>(req, "params");
  const { note } = validated<ReturnNoteBody>(req, "body");

  res.status(200).json({
    success: true,
    data: { returnRequest: await returnService.approveReturn(returnId, note) },
  });
};

export const rejectReturn = async (req: Request, res: Response) => {
  const { returnId } = validated<ReturnIdParam>(req, "params");
  const { note } = validated<RejectReturnBody>(req, "body");

  res.status(200).json({
    success: true,
    data: { returnRequest: await returnService.rejectReturn(returnId, note) },
  });
};

export const receiveReturn = async (req: Request, res: Response) => {
  const { returnId } = validated<ReturnIdParam>(req, "params");
  const { note } = validated<ReturnNoteBody>(req, "body");

  const result = await returnService.receiveReturn(returnId, note);

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const markRefundedManually = async (req: Request, res: Response) => {
  const { returnId } = validated<ReturnIdParam>(req, "params");
  const { reference } = validated<ManualRefundBody>(req, "body");

  res.status(200).json({
    success: true,
    data: {
      returnRequest: await returnService.markReturnRefundedManually(
        returnId,
        reference
      ),
    },
  });
};
