import { Request, Response, NextFunction } from "express";

import { registerUser } from "../services/auth/register.service";
import { verifyRegistrationOtp } from "../services/auth/verify.service";
import { resendRegistrationOtp } from "../services/auth/resend.service";
import { issueSession, loginUser } from "../services/auth/login.service";
import {
  beginMfaEnrollment,
  completeMfaChallenge,
  confirmMfaEnrollment,
  disableMfa,
  getMfaStatus,
} from "../services/auth/mfa.service";
import { validated } from "../middlewares/validate.middleware";
import { assertRoleInScope } from "../utils/auth-scope.util";
import type {
  ChangePasswordInput,
  DisableMfaInput,
  ForgotPasswordInput,
  MfaCodeInput,
  ResetPasswordInput,
} from "../validations/auth.validation";
import {
  changePassword,
  requestPasswordReset,
  resetPassword,
} from "../services/auth/password.service";
import { refreshAccessToken } from "../services/auth/refresh.service";
import { logoutUser } from "../services/auth/logout.service";
import prisma from "../config/prisma";
import AppError from "../errors/AppError";
import { sessionHintCookieName, sessionHintCookieOptions, clearSessionHintCookieOptions, ADMIN_MFA_CHALLENGE_COOKIE, adminMfaChallengeCookieOptions, clearAdminMfaChallengeCookieOptions, accessTokenCookieName, accessTokenCookieOptions, clearAccessTokenCookieOptions, clearLegacyRefreshTokenCookieOptions, clearRefreshTokenCookieOptions, clearRegistrationTokenCookieOptions, refreshTokenCookieName, refreshTokenCookieOptions, REGISTRATION_TOKEN_COOKIE, registrationTokenCookieOptions, } from "../utils/auth-cookie.util";
import type { AuthScope } from "../utils/jwt";
import { ALL_PERMISSIONS } from "../utils/permissions.util";


const requireRegistrationToken = (req: Request) => {
  const registrationToken =
    req.cookies?.[REGISTRATION_TOKEN_COOKIE];

  if (
    typeof registrationToken !== "string" ||
    registrationToken.length === 0
  ) {
    throw new AppError(
      "Registration session is missing or has expired. Please register again.",
      400
    );
  }

  return registrationToken;
};

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const registration = await registerUser(req.body);

    res.cookie(
      REGISTRATION_TOKEN_COOKIE,
      registration.registrationToken,
      registrationTokenCookieOptions
    );

    return res.status(201).json({
      success: true,
      message: "Verification code sent",
      data: {
        email: registration.email,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const verifyOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const registrationToken = requireRegistrationToken(req);

    const { otp } = req.body;

    const user = await verifyRegistrationOtp(
      registrationToken,
      otp
    );

    res.clearCookie(
      REGISTRATION_TOKEN_COOKIE,
      clearRegistrationTokenCookieOptions
    );

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

export const resendOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const registrationToken = requireRegistrationToken(req);

    const result = await resendRegistrationOtp(
      registrationToken
    );

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

const setSessionCookies = (
  res: Response,
  scope: AuthScope,
  tokens: { accessToken: string; refreshToken: string }
) => {
  res.cookie(
    accessTokenCookieName(scope),
    tokens.accessToken,
    accessTokenCookieOptions(scope)
  );

  res.cookie(
    refreshTokenCookieName(scope),
    tokens.refreshToken,
    refreshTokenCookieOptions(scope)
  );

  res.cookie(
    sessionHintCookieName(scope),
    "1",
    sessionHintCookieOptions()
  );
};

const clearSessionHint = (res: Response, scope: AuthScope) => {
  res.clearCookie(
    sessionHintCookieName(scope),
    clearSessionHintCookieOptions()
  );
};

/**
 * Answers 401 before any rate limiter runs when there is no refresh
 * cookie at all: such a request cannot succeed, so it must not spend a
 * shared budget (M5).
 */
export const rejectMissingRefreshCookie =
  (scope: AuthScope) =>
  (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[refreshTokenCookieName(scope)];

    if (typeof token === "string" && token.length > 0) {
      return next();
    }

    clearSessionHint(res, scope);

    return res.status(401).json({
      success: false,
      message: "Refresh token missing",
    });
  };

const createLogin = (scope: AuthScope) => async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await loginUser(req.body, scope);

    if (result.kind === "MFA_REQUIRED") {
      res.cookie(
        ADMIN_MFA_CHALLENGE_COOKIE,
        result.challengeToken,
        adminMfaChallengeCookieOptions
      );

      return res.status(200).json({
        success: true,
        message: "Enter the code from your authenticator app",
        data: {
          mfaRequired: true,
        },
      });
    }

    setSessionCookies(res, scope, result);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: result.user,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** Second step of an admin login with MFA enabled. */
export const adminLoginMfa = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const challenge = req.cookies?.[ADMIN_MFA_CHALLENGE_COOKIE];

    if (typeof challenge !== "string" || challenge.length === 0) {
      throw new AppError(
        "Your sign-in session has expired. Please sign in again.",
        401
      );
    }

    const { code } = validated<MfaCodeInput>(req, "body");

    const userId = await completeMfaChallenge(challenge, code);

    res.clearCookie(
      ADMIN_MFA_CHALLENGE_COOKIE,
      clearAdminMfaChallengeCookieOptions
    );

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new AppError("Your account is not active", 403);
    }

    assertRoleInScope(user.role, "admin");

    const session = await issueSession(user, "admin");

    setSessionCookies(res, "admin", session);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: session.user,
      },
    });
  } catch (error) {
    next(error);
  }
};

const createChangePassword =
  (scope: AuthScope) => async (req: Request, res: Response) => {
    const { currentPassword, newPassword } =
      validated<ChangePasswordInput>(req, "body");

    const session = await changePassword(
      req.user!.id,
      currentPassword,
      newPassword,
      scope
    );

    // Other sessions were revoked; this one continues on a fresh pair.
    setSessionCookies(res, scope, session);

    res.status(200).json({
      success: true,
      message: "Password changed. Other devices have been signed out.",
    });
  };

export const changeCustomerPassword = createChangePassword("storefront");

export const changeAdminPassword = createChangePassword("admin");

export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = validated<ForgotPasswordInput>(req, "body");

  await requestPasswordReset(email);

  // Identical whether or not the account exists.
  res.status(200).json({
    success: true,
    message:
      "If an account exists for that email, we have sent a link to reset the password.",
  });
};

export const resetPasswordController = async (
  req: Request,
  res: Response
) => {
  const { token, newPassword } = validated<ResetPasswordInput>(req, "body");

  await resetPassword(token, newPassword);

  res.status(200).json({
    success: true,
    message: "Password updated. Please sign in with your new password.",
  });
};

export const mfaStatus = async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: await getMfaStatus(req.user!.id),
  });
};

export const mfaSetup = async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: await beginMfaEnrollment(req.user!.id, req.user!.email),
  });
};

export const mfaEnable = async (req: Request, res: Response) => {
  const { code } = validated<MfaCodeInput>(req, "body");

  res.status(200).json({
    success: true,
    data: await confirmMfaEnrollment(req.user!.id, code),
  });
};

export const mfaDisable = async (req: Request, res: Response) => {
  const { code, password } = validated<DisableMfaInput>(req, "body");

  res.status(200).json({
    success: true,
    data: await disableMfa(req.user!.id, password, code),
  });
};

export const login = createLogin("storefront");

export const adminLogin = createLogin("admin");

const createLogout = (scope: AuthScope) => async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const refreshCookie = refreshTokenCookieName(scope);

    res.clearCookie(
      accessTokenCookieName(scope),
      clearAccessTokenCookieOptions(scope)
    );

    res.clearCookie(
      refreshCookie,
      clearRefreshTokenCookieOptions(scope)
    );

    if (scope === "storefront") {
      res.clearCookie(
        refreshCookie,
        clearLegacyRefreshTokenCookieOptions
      );
    }

    clearSessionHint(res, scope);

    // Cleared first so the browser is disarmed even if this fails
    await logoutUser(req.cookies[refreshCookie], scope);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const logout = createLogout("storefront");

export const adminLogout = createLogout("admin");


export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new AppError("Unauthorized", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id }, // was req.user.userId
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        permissions: true,
      },
    });

    if (!user) {
      throw new AppError("Unauthorized", 401);
    }

    if (user.status !== "ACTIVE") {
      throw new AppError("Account is not active", 403);
    }

    const { permissions, ...profile } = user;

    return res.status(200).json({
      success: true,
      data: {
        user:
          // Admin UIs gate actions on these (M9); customers have none.
          profile.role === "CUSTOMER"
            ? profile
            : {
                ...profile,
                permissions:
                  profile.role === "SUPER_ADMIN" ? ALL_PERMISSIONS : permissions,
              },
      },
    });
  } catch (error) {
    next(error);
  }
};


const createRefreshToken = (scope: AuthScope) => async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const refreshToken =
      req.cookies[refreshTokenCookieName(scope)];

    if (!refreshToken) {
      throw new AppError("Refresh token missing", 401);
    }

    const result = await refreshAccessToken(
      refreshToken,
      scope
    );

    // Rotated on every refresh — the cookies have to move with it
    setSessionCookies(res, scope, result);

    return res.status(200).json({
      success: true,
      message: "Access token refreshed",
    });
  } catch (error) {
    // A dead session must stop advertising itself.
    if (
      error instanceof AppError &&
      (error.statusCode === 401 || error.statusCode === 403)
    ) {
      clearSessionHint(res, scope);
    }

    next(error);
  }
};

export const refreshToken = createRefreshToken("storefront");

export const adminRefreshToken = createRefreshToken("admin");
