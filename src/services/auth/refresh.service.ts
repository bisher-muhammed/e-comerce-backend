import jwt from "jsonwebtoken";
import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, RefreshTokenPayload, } from "../../utils/jwt";
import { rotateRefreshSession } from "./refresh-session.service";

export const refreshAccessToken = async (
  token: string
) => {
  let decoded: RefreshTokenPayload;

  try {
    decoded = verifyRefreshToken(token);
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

  const jti = await rotateRefreshSession(
    decoded.sid,
    decoded.jti,
    user.id
  );

  const payload = {
    userId: user.id,
    role: user.role,
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
