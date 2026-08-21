import argon2 from "argon2";
import crypto from "node:crypto";

import redis from "../../config/redis";
import AppError from "../../errors/AppError";
import { sendOtpEmail } from "../email.service";

export const resendRegistrationOtp = async (
  registrationToken: string
) => {
  // 1. Check registration session
  const registrationKey = `registration:${registrationToken}`;

  const storedData = await redis.get(registrationKey);

  if (!storedData) {
    throw new AppError(
      "Registration session has expired. Please register again.",
      400
    );
  }

  // 2. Get registration data
  const registrationData = JSON.parse(storedData) as {
    firstName: string;
    lastName: string | null;
    email: string;
    passwordHash: string;
  };

  // 3. Generate new OTP
  const otp = crypto
    .randomInt(100000, 1000000)
    .toString();

  // 4. Hash new OTP
  const otpHash = await argon2.hash(otp);

  // 5. Replace previous OTP
  // New OTP gets a fresh 2-minute lifetime
  const otpKey = `otp:${registrationToken}`;

  await redis.set(otpKey, otpHash, {
    EX: 120,
  });

  // 6. Send new OTP
  await sendOtpEmail(
    registrationData.email,
    otp
  );

  // Development only
  console.log(
    `New OTP for ${registrationData.email}: ${otp}`
  );

  return {
    message: "A new verification code has been sent",
  };
};
