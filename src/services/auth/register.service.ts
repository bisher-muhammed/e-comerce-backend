import argon2 from "argon2";
import crypto from "node:crypto";

import prisma from "../../config/prisma";
import redis from "../../config/redis";
import { RegisterInput } from "../../validations/auth.validation";
import { issueOtp, registrationKey, REGISTRATION_TTL_SECONDS, } from "./otp.service";
import AppError from "../../errors/AppError";

export const registerUser = async (data: RegisterInput) => {
  const { firstName, lastName, email, password } = data;
  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    throw new AppError("Email is already registered", 409);
  }

  // 2. Hash the password
  const passwordHash = await argon2.hash(password);

  // 3. Generate registration token
  const registrationToken = crypto
    .randomBytes(32)
    .toString("hex");

  // 4. Store registration data
  // Registration session expires after 10 minutes
  const registrationData = {
    firstName,
    lastName: lastName ?? null,
    email,
    passwordHash,
  };

  await redis.set(
    registrationKey(registrationToken),
    JSON.stringify(registrationData),
    {
      EX: REGISTRATION_TTL_SECONDS,
    }
  );

  // 5. Mint and send the first OTP
  await issueOtp(registrationToken, email);

  return {
    registrationToken,
  };
};
