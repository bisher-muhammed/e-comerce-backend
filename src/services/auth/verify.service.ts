import argon2 from "argon2";

import prisma from "../../config/prisma";
import redis from "../../config/redis";
import AppError from "../../errors/AppError";
import { burnOtp, clearRegistrationSession, getRegistrationSession, otpKey, spendOtpAttempt, } from "./otp.service";

export const verifyRegistrationOtp = async (
  registrationToken: string,
  otp: string
) => {
  // 1. Get registration session
  const registrationData =
    await getRegistrationSession(
      registrationToken,
      "Registration session has expired or is invalid"
    );

  // 2. Get OTP
  const otpHash = await redis.get(
    otpKey(registrationToken)
  );

  if (!otpHash) {
    throw new AppError(
      "Verification code has expired. Please request a new code.",
      400
    );
  }

  // 3. Spend one guess
  // Charged before the hash comparison, so a burned session cannot
  // be used to keep argon2 busy
  const { remaining } = await spendOtpAttempt(
    registrationToken
  );

  // 4. Verify OTP
  const isValidOtp = await argon2.verify(
    otpHash,
    otp
  );

  if (!isValidOtp) {
    // Last guess spent: burn the code so a later hit is worthless
    if (remaining === 0) {
      await burnOtp(registrationToken);

      throw new AppError(
        "Too many incorrect codes. Please request a new verification code.",
        429
      );
    }

    throw new AppError(
      `Invalid verification code. ${remaining} attempt${
        remaining === 1 ? "" : "s"
      } remaining.`,
      400
    );
  }

  // 5. Check whether email was registered meanwhile
  const existingUser = await prisma.user.findUnique({
    where: {
      email: registrationData.email,
    },
  });

  if (existingUser) {
    await clearRegistrationSession(registrationToken);

    throw new AppError(
      "Email is already registered",
      409
    );
  }

  // 6. Create user
  const user = await prisma.user.create({
    data: {
      firstName: registrationData.firstName,
      lastName: registrationData.lastName,
      email: registrationData.email,
      status :"ACTIVE",

      credential: {
        create: {
          passwordHash: registrationData.passwordHash,
        },
      },
    },

    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // 7. Registration completed
  // Drop the whole session so the code cannot be replayed
  await clearRegistrationSession(registrationToken);

  return user;
};
