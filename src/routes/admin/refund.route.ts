import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { permitByMethod } from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";
import * as refundController from "../../controllers/admin/refund.controller";
import {
  listRefundsQuerySchema,
  refundIdParamSchema,
  retryRefundBodySchema,
} from "../../validations/admin/refund.validation";

const router = Router();

router.use(authenticateAdmin, permitByMethod("orders.read", "orders.refund"));

router.get(
  "/",
  validate({ query: listRefundsQuerySchema }),
  refundController.listRefunds
);

router.post(
  "/:refundId/retry",
  validate({ params: refundIdParamSchema, body: retryRefundBodySchema }),
  refundController.retryRefund
);

router.post(
  "/:refundId/reconcile",
  validate({ params: refundIdParamSchema }),
  refundController.reconcileRefund
);

export default router;
