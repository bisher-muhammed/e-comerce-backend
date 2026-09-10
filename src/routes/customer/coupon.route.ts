
import { Router } from "express";

import { authenticate } from "../../middlewares/auth.middleware";

import { validate } from "../../middlewares/validate.middleware";

import {
  couponCodeParamsSchema,
  validateCouponSchema,
  claimCouponSchema,
} from "../../validations/customer/coupon.validation";

import {
  getAvailableCouponsController,
  validateCouponController,
  claimCouponController,
} from "../../controllers/customers/coupon.controller";

const router = Router();



router.use(authenticate);


router.get(
  "/",
  getAvailableCouponsController
);


router.get(
  "/:code",
  validate({
    params: couponCodeParamsSchema,
    query: validateCouponSchema.pick({
      subtotal: true,
    }),
  }),
  validateCouponController
);

router.post(
  "/:code/claim",
  validate({
    params: couponCodeParamsSchema,
    body: claimCouponSchema,
  }),
  claimCouponController
);

export default router;

