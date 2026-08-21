import argon2 from "argon2";
import crypto from "node:crypto";

import prisma from "../../config/prisma";
import redis from "../../config/redis";
import { RegisterInput } from "../../validations/auth.validation";
import { sendOtpEmail } from "../email.service";
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

  // 4. Generate 6-digit OTP
  const otp = crypto
    .randomInt(100000, 1000000)
    .toString();

  // 5. Hash OTP
  const otpHash = await argon2.hash(otp);

  // 6. Store registration data
  // Registration session expires after 10 minutes
  const registrationData = {
    firstName,
    lastName: lastName ?? null,
    email,
    passwordHash,
  };

  await redis.set(
    `registration:${registrationToken}`,
    JSON.stringify(registrationData),
    {
      EX: 600,
    }
  );

  // 7. Store OTP separately
  // OTP expires after 2 minutes
  await redis.set(
    `otp:${registrationToken}`,
    otpHash,
    {
      EX: 120,
    }
  );

  // 8. Send OTP email
  await sendOtpEmail(email, otp);

  // Development only
  console.log(`OTP for ${email}: ${otp}`);

  return {
    registrationToken,
  };
};
