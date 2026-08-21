import argon2 from "argon2";

import prisma from "../../config/prisma";
import redis from "../../config/redis";
import AppError from "../../errors/AppError";

export const verifyRegistrationOtp = async (
  registrationToken: string,
  otp: string
) => {
  // 1. Get registration session
  const registrationKey = `registration:${registrationToken}`;

  const storedData = await redis.get(registrationKey);

  if (!storedData) {
    throw new AppError(
      "Registration session has expired or is invalid",
      400
    );
  }

  const registrationData = JSON.parse(storedData) as {
    firstName: string;
    lastName: string | null;
    email: string;
    passwordHash: string;
  };

  // 2. Get OTP
  const otpKey = `otp:${registrationToken}`;

  const otpHash = await redis.get(otpKey);

  if (!otpHash) {
    throw new AppError(
      "Verification code has expired. Please request a new code.",
      400
    );
  }

  // 3. Verify OTP
  const isValidOtp = await argon2.verify(
    otpHash,
    otp
  );

  if (!isValidOtp) {
    throw new AppError(
      "Invalid verification code",
      400
    );
  }

  // 4. Check whether email was registered meanwhile
  const existingUser = await prisma.user.findUnique({
    where: {
      email: registrationData.email,
    },
  });

  if (existingUser) {
    await redis.del(registrationKey);
    await redis.del(otpKey);

    throw new AppError(
      "Email is already registered",
      409
    );
  }

  // 5. Create user
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

  // 6. Registration completed
  // Remove both Redis keys
  await redis.del(registrationKey);
  await redis.del(otpKey);

  return user;
};
