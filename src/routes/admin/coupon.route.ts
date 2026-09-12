
import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/authorize.middleware";
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
router.use(authorize("ADMIN", "SUPER_ADMIN"));

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
