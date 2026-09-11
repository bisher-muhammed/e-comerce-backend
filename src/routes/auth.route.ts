import { Router } from "express";

import { validate } from "../middlewares/validate.middleware";
import { authenticate } from "../middlewares/auth.middleware";

import {
  loginLimiter,
  refreshTokenLimiter,
  registerLimiter,
  resendOtpLimiter,
  verifyOtpLimiter,
} from "../middlewares/rate-limit.middleware";


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
  logout,
  getMe,
  refreshToken

} from "../controllers/auth.controller";

const router = Router();


router.get("/me", authenticate,getMe);

router.post(
  "/register",
  ...registerLimiter,
  validate({ body: registerSchema }),
  register
);

router.post(
  "/verify-otp",
  ...verifyOtpLimiter,
  validate({ body: verifyOtpSchema }),
  verifyOtp
);

router.post(
  "/resend-otp",
  ...resendOtpLimiter,
  validate({ body: resendOtpSchema }),
  resendOtp
);

router.post("/login",
  ...loginLimiter,
  validate({ body: loginSchema }),
  login
)

router.post("/logout", logout);


router.post(
  "/refresh-token",
  refreshTokenLimiter,
  refreshToken
);


export default router;
