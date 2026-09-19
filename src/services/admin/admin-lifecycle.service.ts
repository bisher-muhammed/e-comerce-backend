/*
 * SUPER_ADMIN management of admin accounts (audit M7). Every action that
 * takes access away is immediate: refresh sessions are revoked and the
 * cached identity dropped, so the next request with an old access token is
 * refused by the status check in authenticate().
 */
import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { invalidateAuthenticatedUser } from "../../utils/auth-user-cache.util";
import { revokeAllRefreshSessions } from "../auth/refresh-session.service";
import { resetMfa } from "../auth/mfa.service";

const ADMIN_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Only plain ADMIN accounts are managed here, never the caller. */
const loadManagedAdmin = async (id: number, actorId: number) => {
  if (id === actorId) {
    throw new AppError("You cannot change your own account here", 400);
  }

  const admin = await prisma.user.findFirst({
    where: { id, role: "ADMIN" },
    select: ADMIN_SELECT,
  });

  if (!admin) {
    throw new AppError("Admin not found", 404);
  }

  return admin;
};

const endAllAccess = async (userId: number) => {
  await revokeAllRefreshSessions(userId);
  await invalidateAuthenticatedUser(userId);
};

export const setAdminStatus = async (
  id: number,
  actorId: number,
  status: "ACTIVE" | "SUSPENDED"
) => {
  const admin = await loadManagedAdmin(id, actorId);

  if (admin.status === "DEACTIVATED") {
    throw new AppError("A removed admin cannot be reactivated", 409);
  }

  const updated = await prisma.user.update({
    where: { id: admin.id },
    data: { status },
    select: ADMIN_SELECT,
  });

  await endAllAccess(admin.id);

  return updated;
};

/**
 * "Delete": the account is kept (admin actions reference it) but can
 * never sign in again.
 */
export const removeAdmin = async (id: number, actorId: number) => {
  const admin = await loadManagedAdmin(id, actorId);

  const updated = await prisma.user.update({
    where: { id: admin.id },
    data: { status: "DEACTIVATED" },
    select: ADMIN_SELECT,
  });

  await endAllAccess(admin.id);

  return updated;
};

export const forceLogoutAdmin = async (id: number, actorId: number) => {
  const admin = await loadManagedAdmin(id, actorId);
  await endAllAccess(admin.id);
  return admin;
};

export const resetAdminMfa = async (id: number, actorId: number) => {
  const admin = await loadManagedAdmin(id, actorId);
  await resetMfa(admin.id);
  await endAllAccess(admin.id);
  return admin;
};
