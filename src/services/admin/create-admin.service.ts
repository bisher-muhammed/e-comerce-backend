import argon2 from "argon2";

import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { invalidateAuthenticatedUser } from "../../utils/auth-user-cache.util";
import { CreateAdminInput } from "../../validations/admin.validation";
import { DEFAULT_ADMIN_PERMISSIONS } from "../../utils/permissions.util";
import {
  assertPasswordNotBreached,
  assertPasswordNotPersonal,
} from "../../utils/password-policy.util";

export const createAdmin = async (
  data: CreateAdminInput
) => {
  const {
    firstName,
    lastName,
    email,
    password,
    permissions,
  } = data;

  // 1. Check whether the email is already registered
  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    throw new AppError(
      "Email is already registered",
      409
    );
  }

  // 2. Password policy beyond the schema (M4)
  assertPasswordNotPersonal(password, email);
  await assertPasswordNotBreached(password);

  // 3. Hash the password
  const passwordHash = await argon2.hash(password);

  // 3. Create admin account
  const admin = await prisma.user.create({
    data: {
      firstName,
      lastName: lastName ?? null,
      email,
      role: "ADMIN",
      status: "ACTIVE",
      permissions: permissions ?? DEFAULT_ADMIN_PERMISSIONS,

      credential: {
        create: {
          passwordHash,
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
      permissions: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return admin;
};

export const listAdmins = async ()=>{
  return prisma.user.findMany({
    where:{
      role:"ADMIN",
    },
    select:{
      id:true,
      email:true,
      firstName:true,
      lastName:true,
      role:true,
      status:true,
      createdAt:true,
      updatedAt:true,
    },
    orderBy:{
      createdAt:"desc",
    },

  })
}

export const getAdminById = async (
  id:number
)=>{
  const admin = await prisma.user.findFirst({
    where:{
      id,
      role:"ADMIN",

    },
    select:{
      id:true,
      email:true,
      firstName:true,
      lastName:true,
      role:true,
      status:true,
      createdAt:true,
      updatedAt:true,
    },
  });
  if(!admin){
    throw new AppError("Admin not found",404)
  }
  return admin
}



/** SUPER_ADMIN replaces an admin's permission set (M9). */
export const setAdminPermissions = async (
  id: number,
  permissions: string[]
) => {
  const admin = await prisma.user.findFirst({
    where: { id, role: "ADMIN" },
    select: { id: true },
  });

  if (!admin) {
    throw new AppError("Admin not found", 404);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { permissions: [...new Set(permissions)].sort() },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      permissions: true,
    },
  });

  // Takes effect on the admin's very next request.
  await invalidateAuthenticatedUser(id);

  return updated;
};

export const listAuditLogs = async (params: {
  page: number;
  limit: number;
  actorId?: number;
  entityType?: string;
  entityId?: string;
}) => {
  const where = {
    ...(params.actorId !== undefined && { actorId: params.actorId }),
    ...(params.entityType && { entityType: params.entityType }),
    ...(params.entityId && { entityId: params.entityId }),
  };

  const [logs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const totalPages = Math.max(Math.ceil(total / params.limit), 1);

  return {
    logs,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages,
      hasNextPage: params.page < totalPages,
      hasPreviousPage: params.page > 1,
    },
  };
};
