import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/authorize.middleware";
import { validate } from "../../middlewares/validate.middleware";

import {
  restockVariantController,
  adjustVariantStockController,
  listStockMovementsController,
} from "../../controllers/admin/stock-flow.controller";

import {
  variantIdParamSchema,
  restockSchema,
  manualAdjustmentSchema,
  listStockMovementsQuerySchema,
} from "../../validations/admin/stockflow.validation";

const router = Router();

// All stock movement routes require authentication + admin authorization
router.use(authenticateAdmin);
router.use(authorize("ADMIN", "SUPER_ADMIN"));

// ============================================================
// VARIANT STOCK ACTIONS
// ============================================================

// POST /admin/stock-movements/variants/:variantId/restock
router.post(
  "/variants/:variantId/restock",
  validate({
    params: variantIdParamSchema,
    body: restockSchema,
  }),
  restockVariantController
);

// POST /admin/stock-movements/variants/:variantId/adjust
router.post(
  "/variants/:variantId/adjust",
  validate({
    params: variantIdParamSchema,
    body: manualAdjustmentSchema,
  }),
  adjustVariantStockController
);

router.get(
  "/variants/:variantId",
  validate({
    params: variantIdParamSchema,
    query: listStockMovementsQuerySchema,
  }),
  listStockMovementsController
);

export default router;