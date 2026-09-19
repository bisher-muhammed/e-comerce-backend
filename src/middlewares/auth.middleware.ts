import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import AppError from "../errors/AppError";
import { verifyAccessToken, type AuthScope } from "../utils/jwt";
import { accessTokenCookieName } from "../utils/auth-cookie.util";
import { loadAuthenticatedUser } from "../utils/auth-user-cache.util";
import { isAdminMfaRequired } from "../services/auth/mfa.service";

// What an admin without MFA may still reach when MFA is mandatory.
const MFA_ENROLMENT_PATHS = [
  "/api/v1/auth/admin/mfa",
  "/api/v1/auth/admin/me",
  "/api/v1/auth/admin/logout",
];

const createAuthenticate = (scope: AuthScope) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const accessToken =
        req.cookies[accessTokenCookieName(scope)];

      if (!accessToken) {
        throw new AppError("Authentication required", 401);
      }


      const decoded = verifyAccessToken(accessToken, scope);


      const user = await loadAuthenticatedUser(
        decoded.userId
      );

      if (!user) {
        throw new AppError("User not found", 401);
      }

      // 4. Check current account status
      if (user.status !== "ACTIVE") {
        throw new AppError(
          "Account is not active",
          403
        );
      }


      if (
        scope === "admin" &&
        isAdminMfaRequired() &&
        !user.mfaEnabled &&
        !MFA_ENROLMENT_PATHS.some((path) =>
          req.originalUrl.split("?")[0].startsWith(path)
        )
      ) {
        throw new AppError(
          "Set up two-factor authentication to continue",
          403,
          "MFA_ENROLLMENT_REQUIRED"
        );
      }

      req.user = user;

      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return next(
          new AppError(
            "Access token has expired",
            401
          )
        );
      }

      if (error instanceof jwt.JsonWebTokenError) {
        return next(
          new AppError(
            "Invalid access token",
            401
          )
        );
      }

      next(error);
    }
  };
};

export const authenticate = createAuthenticate("storefront");

export const authenticateAdmin = createAuthenticate("admin");
