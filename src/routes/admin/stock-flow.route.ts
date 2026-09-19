import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { permitByMethod } from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";

import {
  restockVariantController,
  adjustVariantStockController,
  listStockMovementsController,
  stockReconciliationController,
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
router.use(permitByMethod("catalog.read", "stock.write"));

// ============================================================
// VARIANT STOCK ACTIONS
// ============================================================

// POST /admin/stock-movements/variants/:variantId/restock
router.get(
  "/reconciliation",
  stockReconciliationController
);

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