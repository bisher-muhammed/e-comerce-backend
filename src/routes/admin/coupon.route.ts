
import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { permitByMethod } from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";

import {
  createCouponController,
  listCouponsController,
  updateCouponController,
  deleteCouponController,
  getCouponByIdController,
  updateCouponStatusController,
} from "../../controllers/admin/coupon.controller";

import {
  couponIdSchema,
  createCouponSchema,
  listCouponsSchema,
  updateCouponSchema,
  updateCouponStatusSchema,
} from "../../validations/admin/coupon.validation";

const router = Router();

// All coupon routes require authentication + admin authorization
router.use(authenticateAdmin);
router.use(permitByMethod("coupons.read", "coupons.write"));

// ============================================================
// COUPONS
// ============================================================

// GET /admin/coupons
// POST /admin/coupons
router
  .route("/")
  .get(validate({ query: listCouponsSchema }), listCouponsController)
  .post(validate({ body: createCouponSchema }), createCouponController);

// ============================================================
// COUPON BY ID
// ============================================================

router
  .route("/:id")
  .get(validate({ params: couponIdSchema }), getCouponByIdController)
  .patch(
    validate({
      params: couponIdSchema,
      body: updateCouponSchema,
    }),
    updateCouponController
  )
  .delete(validate({ params: couponIdSchema }), deleteCouponController);

// ============================================================
// COUPON STATUS
// ============================================================

// PATCH /admin/coupons/:id/status
router.patch(
  "/:id/status",
  validate({
    params: couponIdSchema,
    body: updateCouponStatusSchema,
  }),
  updateCouponStatusController
);

export default router;
