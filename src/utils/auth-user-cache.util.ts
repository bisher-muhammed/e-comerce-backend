import prisma from "../config/prisma";
import {
  cacheDelete,
  cacheReadRaw,
  cacheWriteRaw,
} from "./cache.util";

const AUTH_USER_TTL_SECONDS = 60;

export interface AuthenticatedUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string | null;
  role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
  status:
    | "PENDING_VERIFICATION"
    | "ACTIVE"
    | "SUSPENDED"
    | "DEACTIVATED";
  mfaEnabled: boolean;
  permissions: string[];
}

const authUserKey = (userId: number) =>
  `auth:user:${userId}`;

export const loadAuthenticatedUser = async (
  userId: number
): Promise<AuthenticatedUser | null> => {
  const key = authUserKey(userId);

  const hit =
    await cacheReadRaw<AuthenticatedUser>(key);

  if (hit) {
    return hit;
  }

  const row = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      permissions: true,
      credential: { select: { totpEnabledAt: true } },
    },
  });

  if (!row) {
    return null;
  }

  const { credential, ...rest } = row;

  const user: AuthenticatedUser = {
    ...rest,
    mfaEnabled: Boolean(credential?.totpEnabledAt),
  };

  await cacheWriteRaw(
    key,
    user,
    AUTH_USER_TTL_SECONDS
  );

  return user;
};

export const invalidateAuthenticatedUser = async (
  userId: number
): Promise<void> => {
  await cacheDelete(authUserKey(userId));
};
