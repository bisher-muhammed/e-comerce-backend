import { Request, Response, NextFunction } from "express";

import {
  createAdmin,
  listAdmins,
  getAdminById,
  listAuditLogs,
  setAdminPermissions,
} from "../services/admin/create-admin.service";
import { PERMISSIONS } from "../utils/permissions.util";

import { validated } from "../middlewares/validate.middleware";
import {
  forceLogoutAdmin,
  removeAdmin,
  resetAdminMfa,
  setAdminStatus,
} from "../services/admin/admin-lifecycle.service";

import type {
  AdminIdParam,
  AdminPermissionsInput,
  AdminStatusInput,
  CreateAdminInput,
  ListAuditLogsQuery,
} from "../validations/admin.validation";

export const listPermissionsController = (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: Object.entries(PERMISSIONS).map(([key, description]) => ({
      key,
      description,
    })),
  });
};

export const setAdminPermissionsController = async (
  req: Request,
  res: Response
) => {
  const { id } = validated<AdminIdParam>(req, "params");
  const { permissions } = validated<AdminPermissionsInput>(req, "body");

  res.status(200).json({
    success: true,
    data: await setAdminPermissions(id, permissions),
  });
};

export const listAuditLogsController = async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    ...(await listAuditLogs(validated<ListAuditLogsQuery>(req, "query"))),
  });
};

export const setAdminStatusController = async (req: Request, res: Response) => {
  const { id } = validated<AdminIdParam>(req, "params");
  const { status } = validated<AdminStatusInput>(req, "body");

  res.status(200).json({
    success: true,
    data: await setAdminStatus(id, req.user!.id, status),
  });
};

export const removeAdminController = async (req: Request, res: Response) => {
  const { id } = validated<AdminIdParam>(req, "params");

  res.status(200).json({
    success: true,
    data: await removeAdmin(id, req.user!.id),
  });
};

export const forceLogoutAdminController = async (req: Request, res: Response) => {
  const { id } = validated<AdminIdParam>(req, "params");

  await forceLogoutAdmin(id, req.user!.id);

  res.status(200).json({ success: true, message: "Admin signed out everywhere" });
};

export const resetAdminMfaController = async (req: Request, res: Response) => {
  const { id } = validated<AdminIdParam>(req, "params");

  await resetAdminMfa(id, req.user!.id);

  res.status(200).json({
    success: true,
    message: "Two-factor authentication reset; the admin must enrol again",
  });
};

export const createAdminController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const admin = await createAdmin(
      validated<CreateAdminInput>(req, "body")
    );

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: admin,
    });
  } catch (error) {
    next(error);
  }
};

export const listAdminsController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const admins = await listAdmins();

    res.status(200).json({
      success: true,
      message: "Admins retrieved successfully",
      data: admins,
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<AdminIdParam>(req, "params");

    const admin = await getAdminById(id);

    res.status(200).json({
      success: true,
      message: "Admin retrieved successfully",
      data: admin,
    });
  } catch (error) {
    next(error);
  }
};