import { Request, Response, NextFunction } from "express";

import {
  createAdmin,
  listAdmins,
  getAdminById,
} from "../services/admin/create-admin.service";

import { CreateAdminInput } from "../validations/admin.validation";

export const createAdminController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const admin = await createAdmin(
      req.body as CreateAdminInput
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
    const id = Number(req.params.id);

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