import argon2 from "argon2";
import crypto from "node:crypto";
import redis from "../../config/redis";
import AppError from "../../errors/AppError";
import { sendOtpEmail } from "../email.service";


// Registration session lifetime
export const REGISTRATION_TTL_SECONDS = 600;

// A single OTP is valid for 2 minutes
export const OTP_TTL_SECONDS = 120;

// ...and may be guessed this many times before it is burned
export const MAX_OTP_ATTEMPTS = 5;

// Whole-session resend budget, no more often than once a minute
export const MAX_OTP_RESENDS = 3;

export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export const registrationKey = (
  registrationToken: string
) => `registration:${registrationToken}`;

export const otpKey = (registrationToken: string) =>
  `otp:${registrationToken}`;

const attemptsKey = (registrationToken: string) =>
  `otp:attempts:${registrationToken}`;

const resendsKey = (registrationToken: string) =>
  `otp:resends:${registrationToken}`;

const cooldownKey = (registrationToken: string) =>
  `otp:cooldown:${registrationToken}`;

export interface RegistrationData {
  firstName: string;
  lastName: string | null;
  email: string;
  passwordHash: string;
}

// ------------------------------------------------------------
// COUNTERS
// ------------------------------------------------------------

const bumpCounter = async (key: string) => {
  const replies = await redis
    .multi()
    .incr(key)
    .expire(key, REGISTRATION_TTL_SECONDS)
    .exec();

  return Number(replies[0]);
};

// ------------------------------------------------------------
// ISSUE A CODE
// ------------------------------------------------------------

export const issueOtp = async (
  registrationToken: string,
  email: string
) => {
  const otp = crypto
    .randomInt(100000, 1000000)
    .toString();

  await sendOtpEmail(
    email,
    otp,
    OTP_TTL_SECONDS / 60
  );

  const otpHash = await argon2.hash(otp);

  await redis.set(
    otpKey(registrationToken),
    otpHash,
    {
      EX: OTP_TTL_SECONDS,
    }
  );

  await redis.del(attemptsKey(registrationToken));

  await redis.set(
    cooldownKey(registrationToken),
    "1",
    {
      EX: OTP_RESEND_COOLDOWN_SECONDS,
    }
  );

  if (process.env.NODE_ENV !== "production") {
    console.log(`OTP for ${email}: ${otp}`);
  }
};

// ------------------------------------------------------------
// SPEND A GUESS
// ------------------------------------------------------------

export const spendOtpAttempt = async (
  registrationToken: string
) => {
  const attempts = await bumpCounter(
    attemptsKey(registrationToken)
  );

  if (attempts > MAX_OTP_ATTEMPTS) {
    await burnOtp(registrationToken);

    throw new AppError(
      "Too many incorrect codes. Please request a new verification code.",
      429
    );
  }

  return {
    remaining: MAX_OTP_ATTEMPTS - attempts,
  };
};

export const burnOtp = async (
  registrationToken: string
) => {
  await redis.del(otpKey(registrationToken));
};

// ------------------------------------------------------------
// SPEND A RESEND
// ------------------------------------------------------------

export const spendOtpResend = async (
  registrationToken: string
) => {
  const cooldown = await redis.ttl(
    cooldownKey(registrationToken)
  );

  if (cooldown > 0) {
    throw new AppError(
      `Please wait ${cooldown} seconds before requesting another code.`,
      429
    );
  }

  const resends = await bumpCounter(
    resendsKey(registrationToken)
  );

  if (resends > MAX_OTP_RESENDS) {
    throw new AppError(
      "Too many verification codes requested. Please register again.",
      429
    );
  }
};

export const refundOtpResend = async (
  registrationToken: string
) => {
  await redis.decr(resendsKey(registrationToken));
};

// ------------------------------------------------------------
// END THE SESSION
// ------------------------------------------------------------

export const clearRegistrationSession = async (
  registrationToken: string
) => {
  await redis.del([
    registrationKey(registrationToken),
    otpKey(registrationToken),
    attemptsKey(registrationToken),
    resendsKey(registrationToken),
    cooldownKey(registrationToken),
  ]);
};

// ------------------------------------------------------------
// LOAD THE SESSION
// ------------------------------------------------------------

export const getRegistrationSession = async (
  registrationToken: string,
  expiredMessage: string
): Promise<RegistrationData> => {
  const storedData = await redis.get(
    registrationKey(registrationToken)
  );

  if (!storedData) {
    throw new AppError(expiredMessage, 400);
  }

  return JSON.parse(storedData) as RegistrationData;
};
