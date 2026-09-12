import jwt from "jsonwebtoken";
import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, RefreshTokenPayload, type AuthScope, } from "../../utils/jwt";
import { isRoleInScope } from "../../utils/auth-scope.util";
import { rotateRefreshSession } from "./refresh-session.service";

export const refreshAccessToken = async (
  token: string,
  scope: AuthScope
) => {
  let decoded: RefreshTokenPayload;

  try {
    decoded = verifyRefreshToken(token, scope);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError("Refresh token expired", 401);
    }

    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError("Invalid refresh token", 401);
    }

    throw error;
  }

  if (
    typeof decoded.sid !== "string" ||
    typeof decoded.jti !== "string"
  ) {
    throw new AppError("Invalid refresh token", 401);
  }

  const user = await prisma.user.findUnique({
    where: {
      id: decoded.userId,
    },
    select: {
      id: true,
      role: true,
      status: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 401);
  }

  if (user.status !== "ACTIVE") {
    throw new AppError("Account is not active", 403);
  }

  if (!isRoleInScope(user.role, scope)) {
    if (scope === "admin") {
      throw new AppError(
        "This account does not have admin access",
        403
      );
    }

    throw new AppError("Invalid refresh token", 401);
  }

  const jti = await rotateRefreshSession(
    decoded.sid,
    decoded.jti,
    user.id
  );

  const payload = {
    userId: user.id,
    role: user.role,
    scope,
  };

  return {
    accessToken: generateAccessToken(payload),

    refreshToken: generateRefreshToken({
      ...payload,
      sid: decoded.sid,
      jti,
    }),
  };
};
