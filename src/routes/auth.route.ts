import { Router } from "express";

import { validate } from "../middlewares/validate.middleware";
import { authenticate } from "../middlewares/auth.middleware";


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
  getMe,
  refreshToken

} from "../controllers/auth.controller";

const router = Router();


router.get("/me", authenticate,getMe);

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


router.post(
  "/refresh-token",
  refreshToken
);


export default router;
