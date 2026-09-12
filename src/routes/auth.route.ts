import { Router } from "express";

import { validate } from "../middlewares/validate.middleware";
import {
  authenticate,
  authenticateAdmin,
} from "../middlewares/auth.middleware";

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
  loginSchema
} from "../validations/auth.validation";

import {
  register,
  verifyOtp,
  resendOtp,
  login,
  logout,
  getMe,
  refreshToken,
  adminLogin,
  adminLogout,
  adminRefreshToken

} from "../controllers/auth.controller";

const router = Router();

const adminRouter = Router();

adminRouter.get("/me", authenticateAdmin, getMe);

adminRouter.post(
  "/login",
  ...loginLimiter,
  validate({ body: loginSchema }),
  adminLogin
);

adminRouter.post("/logout", adminLogout);

adminRouter.post(
  "/refresh-token",
  refreshTokenLimiter,
  adminRefreshToken
);

router.use("/admin", adminRouter);


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
