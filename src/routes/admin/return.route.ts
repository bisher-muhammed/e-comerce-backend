import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { permitByMethod } from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";
import * as returnController from "../../controllers/admin/return.controller";
import {
  listReturnsQuerySchema,
  manualRefundBodySchema,
  rejectReturnBodySchema,
  returnIdParamSchema,
  returnNoteBodySchema,
} from "../../validations/admin/return.validation";

const router = Router();

router.use(authenticateAdmin, permitByMethod("orders.read", "returns.manage"));

router.get(
  "/",
  validate({ query: listReturnsQuerySchema }),
  returnController.listReturns
);

router.post(
  "/:returnId/approve",
  validate({ params: returnIdParamSchema, body: returnNoteBodySchema }),
  returnController.approveReturn
);

router.post(
  "/:returnId/reject",
  validate({ params: returnIdParamSchema, body: rejectReturnBodySchema }),
  returnController.rejectReturn
);

router.post(
  "/:returnId/receive",
  validate({ params: returnIdParamSchema, body: returnNoteBodySchema }),
  returnController.receiveReturn
);

router.post(
  "/:returnId/mark-refunded",
  validate({ params: returnIdParamSchema, body: manualRefundBodySchema }),
  returnController.markRefundedManually
);

export default router;
