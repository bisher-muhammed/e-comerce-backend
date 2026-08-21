import argon2 from "argon2";

import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { LoginInput } from "../../validations/auth.validation";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../utils/jwt";

export const loginUser = async (data: LoginInput) => {
  const { email, password } = data;

  const user = await prisma.user.findUnique({
    where: {
      email,
    },
    include: {
      credential: true,
    },
  });

  if (!user || !user.credential) {
    throw new AppError("Invalid email or password", 401);
  }

  if (user.status !== "ACTIVE") {
    throw new AppError("Your account is not active", 403);
  }

  const isPasswordValid = await argon2.verify(
    user.credential.passwordHash,
    password
  );

  if (!isPasswordValid) {
    throw new AppError("Invalid email or password", 401);
  }

  const payload = {
    userId: user.id,
    role: user.role,
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
    },
    accessToken,
    refreshToken,
  };
};