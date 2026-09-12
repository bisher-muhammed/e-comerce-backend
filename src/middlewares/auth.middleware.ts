import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import AppError from "../errors/AppError";
import { verifyAccessToken, type AuthScope } from "../utils/jwt";
import { accessTokenCookieName } from "../utils/auth-cookie.util";
import { loadAuthenticatedUser } from "../utils/auth-user-cache.util";

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
