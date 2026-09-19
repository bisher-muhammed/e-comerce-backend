import argon2 from "argon2";

import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { LoginInput } from "../../validations/auth.validation";
import {
  generateAccessToken,
  generateRefreshToken,
  type AuthScope,
} from "../../utils/jwt";
import { assertRoleInScope } from "../../utils/auth-scope.util";
import { logError } from "../../utils/logger.util";
import { startRefreshSession } from "./refresh-session.service";
import {
  clearLoginFailures,
  FREE_ATTEMPTS,
  reserveLoginAttempt,
} from "./login-throttle.service";
import { createMfaChallenge } from "./mfa.service";

type SessionUser = {
  id: number;
  email: string;
  firstName: string;
  lastName: string | null;
  role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
};

export type LoginResult =
  | {
      kind: "SESSION";
      user: SessionUser;
      accessToken: string;
      refreshToken: string;
    }
  | {
      kind: "MFA_REQUIRED";
      challengeToken: string;
    };

/** Mints an access/refresh pair backed by a new refresh session. */
export const issueSession = async (
  user: SessionUser,
  scope: AuthScope
): Promise<Extract<LoginResult, { kind: "SESSION" }>> => {
  const payload = {
    userId: user.id,
    role: user.role,
    scope,
  };

  const { sid, jti } = await startRefreshSession(user.id);

  return {
    kind: "SESSION",
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
    },
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({ ...payload, sid, jti }),
  };
};

export const loginUser = async (
  data: LoginInput,
  scope: AuthScope
): Promise<LoginResult> => {
  const { email, password } = data;

  // Account-level throttle (M4): counts every attempt on this address,
  // whichever IP it comes from.
  const throttle = await reserveLoginAttempt(email);

  if (!throttle.allowed) {
    const seconds = Math.ceil(throttle.retryAfterMs / 1000);

    throw new AppError(
      `Too many failed sign-in attempts. Try again in ${seconds} second${
        seconds === 1 ? "" : "s"
      }.`,
      429,
      "LOGIN_THROTTLED",
      seconds
    );
  }

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
    if (
      user.role !== "CUSTOMER" &&
      throttle.attempts >= FREE_ATTEMPTS
    ) {
      logError(
        "auth.admin_login_failures",
        new Error("Repeated failed sign-ins on an admin account"),
        { userId: user.id, attempts: throttle.attempts, alert: true }
      );
    }

    throw new AppError("Invalid email or password", 401);
  }

  assertRoleInScope(user.role, scope);

  await clearLoginFailures(email);

  if (scope === "admin" && user.credential.totpEnabledAt) {
    return {
      kind: "MFA_REQUIRED",
      challengeToken: await createMfaChallenge(user.id),
    };
  }

  return issueSession(user, scope);
};
