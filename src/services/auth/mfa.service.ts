/*
 * Admin TOTP second factor (audit M4).
 *
 * Login:   password OK + MFA enabled → a one-time challenge (5 min, 5
 *          guesses) instead of a session; POST /auth/admin/login/mfa with
 *          the code completes it.
 * Enrol:   setup → pending secret (10 min) → enable with a valid code.
 * Replay:  a code's time step can be used once per account.
 * Enforce: ADMIN_MFA_REQUIRED=true stops admins without MFA from using
 *          anything but the enrolment endpoints.
 */
import argon2 from "argon2";
import crypto from "node:crypto";

import prisma from "../../config/prisma";
import redis, { connectRedis } from "../../config/redis";
import AppError from "../../errors/AppError";
import { invalidateAuthenticatedUser } from "../../utils/auth-user-cache.util";
import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  isMfaConfigured,
  matchTotpStep,
  otpauthUrl,
} from "../../utils/totp.util";

export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
const MFA_PENDING_TTL_SECONDS = 10 * 60;
const ISSUER = process.env.MFA_ISSUER ?? "Raviscort Admin";

export const isAdminMfaRequired = () =>
  process.env.ADMIN_MFA_REQUIRED === "true";

const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

const challengeKey = (token: string) => `mfa:challenge:${hashToken(token)}`;
const challengeAttemptsKey = (token: string) =>
  `mfa:challenge:attempts:${hashToken(token)}`;
const pendingKey = (userId: number) => `mfa:pending:${userId}`;
const lastStepKey = (userId: number) => `mfa:last-step:${userId}`;

const assertConfigured = () => {
  if (!isMfaConfigured()) {
    throw new AppError(
      "Two-factor authentication is not configured on this server",
      503
    );
  }
};

// Accept a step only if it is newer than the last accepted one.
const CLAIM_STEP_SCRIPT = `
local last = tonumber(redis.call('GET', KEYS[1]) or '-1')
local step = tonumber(ARGV[1])
if step <= last then return 0 end
redis.call('SET', KEYS[1], step, 'EX', 180)
return 1
`;

const verifyCodeOnce = async (
  userId: number,
  secret: string,
  code: string
) => {
  const step = matchTotpStep(secret, code);

  if (step === null) {
    return false;
  }

  await connectRedis();

  const claimed = await redis.eval(CLAIM_STEP_SCRIPT, {
    keys: [lastStepKey(userId)],
    arguments: [String(step)],
  });

  return Number(claimed) === 1;
};

const loadSecret = async (userId: number) => {
  const credential = await prisma.userCredential.findUnique({
    where: { userId },
    select: { totpSecret: true, totpEnabledAt: true },
  });

  if (!credential?.totpSecret || !credential.totpEnabledAt) {
    return null;
  }

  return decryptSecret(credential.totpSecret);
};

// ============================================================
// LOGIN CHALLENGE
// ============================================================

export const createMfaChallenge = async (userId: number) => {
  await connectRedis();

  const token = crypto.randomBytes(32).toString("hex");

  await redis.set(challengeKey(token), String(userId), {
    EX: MFA_CHALLENGE_TTL_SECONDS,
  });

  return token;
};

/** Returns the user id when the code is right; burns the challenge. */
export const completeMfaChallenge = async (
  token: string,
  code: string
): Promise<number> => {
  assertConfigured();
  await connectRedis();

  const stored = await redis.get(challengeKey(token));

  if (!stored) {
    throw new AppError(
      "Your sign-in session has expired. Please sign in again.",
      401
    );
  }

  const attempts = await redis
    .multi()
    .incr(challengeAttemptsKey(token))
    .expire(challengeAttemptsKey(token), MFA_CHALLENGE_TTL_SECONDS)
    .exec();

  if (Number(attempts[0]) > MFA_CHALLENGE_MAX_ATTEMPTS) {
    await redis.del([challengeKey(token), challengeAttemptsKey(token)]);

    throw new AppError(
      "Too many incorrect codes. Please sign in again.",
      429
    );
  }

  const userId = Number(stored);
  const secret = await loadSecret(userId);

  if (!secret || !(await verifyCodeOnce(userId, secret, code))) {
    throw new AppError("Invalid verification code", 401);
  }

  // Single use: whoever deletes it first completes the login.
  const consumed = await redis.del(challengeKey(token));

  if (consumed === 0) {
    throw new AppError(
      "Your sign-in session has expired. Please sign in again.",
      401
    );
  }

  await redis.del(challengeAttemptsKey(token));

  return userId;
};

// ============================================================
// ENROLMENT
// ============================================================

export const getMfaStatus = async (userId: number) => {
  const credential = await prisma.userCredential.findUnique({
    where: { userId },
    select: { totpEnabledAt: true },
  });

  return {
    enabled: Boolean(credential?.totpEnabledAt),
    required: isAdminMfaRequired(),
    configured: isMfaConfigured(),
  };
};

export const beginMfaEnrollment = async (
  userId: number,
  email: string
) => {
  assertConfigured();

  const status = await getMfaStatus(userId);

  if (status.enabled) {
    throw new AppError(
      "Two-factor authentication is already enabled",
      409
    );
  }

  const secret = generateTotpSecret();

  await connectRedis();
  await redis.set(pendingKey(userId), encryptSecret(secret), {
    EX: MFA_PENDING_TTL_SECONDS,
  });

  return {
    secret,
    otpauthUrl: otpauthUrl(secret, email, ISSUER),
  };
};

export const confirmMfaEnrollment = async (
  userId: number,
  code: string
) => {
  assertConfigured();
  await connectRedis();

  const pending = await redis.get(pendingKey(userId));

  if (!pending) {
    throw new AppError(
      "Setup has expired. Please start again.",
      400
    );
  }

  const secret = decryptSecret(pending);

  if (!(await verifyCodeOnce(userId, secret, code))) {
    throw new AppError("Invalid verification code", 400);
  }

  await prisma.userCredential.update({
    where: { userId },
    data: {
      totpSecret: pending,
      totpEnabledAt: new Date(),
    },
  });

  await redis.del(pendingKey(userId));
  await invalidateAuthenticatedUser(userId);

  return { enabled: true };
};

export const disableMfa = async (
  userId: number,
  password: string,
  code: string
) => {
  assertConfigured();

  if (isAdminMfaRequired()) {
    throw new AppError(
      "Two-factor authentication is required for admin accounts",
      409
    );
  }

  const credential = await prisma.userCredential.findUnique({
    where: { userId },
  });

  const secret = await loadSecret(userId);

  if (
    !credential ||
    !secret ||
    !(await argon2.verify(credential.passwordHash, password)) ||
    !(await verifyCodeOnce(userId, secret, code))
  ) {
    throw new AppError("Password or verification code is incorrect", 401);
  }

  await prisma.userCredential.update({
    where: { userId },
    data: { totpSecret: null, totpEnabledAt: null },
  });

  await invalidateAuthenticatedUser(userId);

  return { enabled: false };
};

/** SUPER_ADMIN recovery for an admin who lost their device (M7). */
export const resetMfa = async (userId: number) => {
  await prisma.userCredential.update({
    where: { userId },
    data: { totpSecret: null, totpEnabledAt: null },
  });

  await invalidateAuthenticatedUser(userId);
};
