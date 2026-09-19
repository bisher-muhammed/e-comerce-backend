/*
 * Password change and recovery (audit M7).
 *
 * - Change: needs the current password; every other session is revoked
 *   and the caller gets a fresh one.
 * - Forgot: always answers the same way (no account enumeration). For an
 *   active account a random single-use token is stored HASHED in Redis for
 *   30 minutes and emailed as a link.
 * - Reset: the token is consumed atomically (GETDEL), the password
 *   replaced, all sessions revoked and the login throttle cleared.
 */
import argon2 from "argon2";
import crypto from "node:crypto";

import prisma from "../../config/prisma";
import redis, { connectRedis } from "../../config/redis";
import AppError from "../../errors/AppError";
import { invalidateAuthenticatedUser } from "../../utils/auth-user-cache.util";
import type { AuthScope } from "../../utils/jwt";
import { logError } from "../../utils/logger.util";
import {
  adminPasswordSchema,
  assertPasswordNotBreached,
  assertPasswordNotPersonal,
  customerPasswordSchema,
} from "../../utils/password-policy.util";
import { sendPasswordResetEmail } from "../email.service";
import { issueSession } from "./login.service";
import { clearLoginFailures } from "./login-throttle.service";
import { revokeAllRefreshSessions } from "./refresh-session.service";

export const RESET_TOKEN_TTL_SECONDS = 30 * 60;

const resetKey = (token: string) =>
  `pwreset:${crypto.createHash("sha256").update(token).digest("hex")}`;

const assertPasswordPolicy = async (
  password: string,
  user: { email: string; role: string }
) => {
  const schema =
    user.role === "CUSTOMER" ? customerPasswordSchema : adminPasswordSchema;

  const parsed = schema.safeParse(password);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400);
  }

  assertPasswordNotPersonal(password, user.email);
  await assertPasswordNotBreached(password);
};

const replacePassword = async (userId: number, password: string) => {
  await prisma.userCredential.update({
    where: { userId },
    data: { passwordHash: await argon2.hash(password) },
  });

  // Every existing session ends: a changed password must lock out
  // whoever else knew the old one.
  await revokeAllRefreshSessions(userId);
  await invalidateAuthenticatedUser(userId);
};

export const changePassword = async (
  userId: number,
  currentPassword: string,
  newPassword: string,
  scope: AuthScope
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { credential: true },
  });

  if (!user?.credential) {
    throw new AppError("Unauthorized", 401);
  }

  if (!(await argon2.verify(user.credential.passwordHash, currentPassword))) {
    throw new AppError("Current password is incorrect", 400);
  }

  if (currentPassword === newPassword) {
    throw new AppError(
      "The new password must be different from the current one",
      400
    );
  }

  await assertPasswordPolicy(newPassword, user);
  await replacePassword(user.id, newPassword);

  return issueSession(user, scope);
};

const resetBaseUrl = (role: string) =>
  role === "CUSTOMER"
    ? process.env.PASSWORD_RESET_URL
    : process.env.ADMIN_PASSWORD_RESET_URL;

export const requestPasswordReset = async (email: string) => {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, status: true },
  });

  // Same response and similar work whether or not the account exists.
  const token = crypto.randomBytes(32).toString("hex");

  if (!user || user.status !== "ACTIVE") {
    return;
  }

  const base = resetBaseUrl(user.role);

  if (!base) {
    logError(
      "password_reset.url_missing",
      new Error("PASSWORD_RESET_URL / ADMIN_PASSWORD_RESET_URL not set"),
      { alert: true }
    );
    return;
  }

  await connectRedis();
  await redis.set(resetKey(token), String(user.id), {
    EX: RESET_TOKEN_TTL_SECONDS,
  });

  const url = new URL(base);
  url.searchParams.set("token", token);

  try {
    await sendPasswordResetEmail(
      user.email,
      url.toString(),
      RESET_TOKEN_TTL_SECONDS / 60
    );
  } catch (error) {
    // Never tell the caller; the response must not reveal the account.
    logError("password_reset.email_failed", error, { userId: user.id });
  }
};

export const resetPassword = async (token: string, newPassword: string) => {
  await connectRedis();

  const userId = await redis.getDel(resetKey(token));

  if (!userId) {
    throw new AppError(
      "This reset link is invalid or has expired. Please request a new one.",
      400
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    throw new AppError(
      "This reset link is invalid or has expired. Please request a new one.",
      400
    );
  }

  await assertPasswordPolicy(newPassword, user);
  await replacePassword(user.id, newPassword);
  await clearLoginFailures(user.email);
};
