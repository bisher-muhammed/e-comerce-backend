import { Router } from "express";

import { validate } from "../middlewares/validate.middleware";

import {
  registerSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema
} from "../validations/auth.validation";

import {
  register,
  verifyOtp,
  resendOtp,
  login,

} from "../controllers/auth.controller";

const router = Router();

router.post(
  "/register",
  validate({ body: registerSchema }),
  register
);

router.post(
  "/verify-otp",
  validate({ body: verifyOtpSchema }),
  verifyOtp
);

router.post(
  "/resend-otp",
  validate({ body: resendOtpSchema }),
  resendOtp
);

router.post("/login",
  validate({ body: loginSchema }),
  login
)

export default router;
