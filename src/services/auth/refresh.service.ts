import jwt from "jsonwebtoken";

import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

import {
  generateAccessToken,
  verifyRefreshToken,
} from "../../utils/jwt";

export const refreshAccessToken = async (
  refreshToken: string
) => {
  try {
    const decoded = verifyRefreshToken(refreshToken);

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

    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
    });

    return accessToken;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError("Refresh token expired", 401);
    }

    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError("Invalid refresh token", 401);
    }

    throw error;
  }
};