import { Router } from "express";

import { validate } from "../middlewares/validate.middleware";
import {
  authenticate,
  authenticateAdmin,
} from "../middlewares/auth.middleware";

import {
  loginLimiter,
  passwordChangeLimiter,
  passwordResetLimiter,
  refreshTokenLimiters,
  registerLimiter,
  resendOtpLimiter,
  verifyOtpLimiter,
} from "../middlewares/rate-limit.middleware";


import {
  registerSchema,
  verifyOtpSchema,
  loginSchema,
  mfaCodeSchema,
  disableMfaSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
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
  adminLoginMfa,
  adminLogout,
  adminRefreshToken,
  rejectMissingRefreshCookie,
  changeCustomerPassword,
  changeAdminPassword,
  forgotPassword,
  resetPasswordController,
  mfaStatus,
  mfaSetup,
  mfaEnable,
  mfaDisable,

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

adminRouter.post(
  "/login/mfa",
  ...verifyOtpLimiter,
  validate({ body: mfaCodeSchema }),
  adminLoginMfa
);

adminRouter.get("/mfa", authenticateAdmin, mfaStatus);

adminRouter.post("/mfa/setup", authenticateAdmin, mfaSetup);

adminRouter.post(
  "/mfa/enable",
  authenticateAdmin,
  validate({ body: mfaCodeSchema }),
  mfaEnable
);

adminRouter.post(
  "/mfa/disable",
  authenticateAdmin,
  validate({ body: disableMfaSchema }),
  mfaDisable
);

adminRouter.post(
  "/change-password",
  authenticateAdmin,
  passwordChangeLimiter,
  validate({ body: changePasswordSchema }),
  changeAdminPassword
);

adminRouter.post("/logout", adminLogout);

adminRouter.post(
  "/refresh-token",
  rejectMissingRefreshCookie("admin"),
  ...refreshTokenLimiters("admin"),
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
  "/change-password",
  authenticate,
  passwordChangeLimiter,
  validate({ body: changePasswordSchema }),
  changeCustomerPassword
);

// One endpoint pair for every account type; the emailed link points at
// the storefront or the admin portal according to the account's role.
router.post(
  "/forgot-password",
  validate({ body: forgotPasswordSchema }),
  ...passwordResetLimiter,
  forgotPassword
);

router.post(
  "/reset-password",
  ...verifyOtpLimiter,
  validate({ body: resetPasswordSchema }),
  resetPasswordController
);


router.post(
  "/refresh-token",
  rejectMissingRefreshCookie("storefront"),
  ...refreshTokenLimiters("storefront"),
  refreshToken
);


export default router;
