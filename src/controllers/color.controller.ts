import {
  Request,
  Response,
  NextFunction,
} from "express";

import {
  createColor,
  listColors,
  getColorById,
  updateColor,
  deleteColor,
} from "../services/admin/color.service";

import { validated } from "../middlewares/validate.middleware";

import type {
  ColorIdParam,
  CreateColorInput,
  UpdateColorInput,
} from "../validations/color.validation";

export const createColorController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const color = await createColor(
      validated<CreateColorInput>(req, "body")
    );

    return res.status(201).json({
      success: true,
      message: "Color created successfully",
      data: color,
    });
  } catch (error) {
    next(error);
  }
};

export const listColorsController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const colors = await listColors();

    return res.status(200).json({
      success: true,
      message: "Colors retrieved successfully",
      data: colors,
    });
  } catch (error) {
    next(error);
  }
};

export const getColorByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<ColorIdParam>(req, "params");

    const color = await getColorById(id);

    return res.status(200).json({
      success: true,
      message: "Color retrieved successfully",
      data: color,
    });
  } catch (error) {
    next(error);
  }
};

export const updateColorController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<ColorIdParam>(req, "params");

    const color = await updateColor(
      id,
      validated<UpdateColorInput>(req, "body")
    );

    return res.status(200).json({
      success: true,
      message: "Color updated successfully",
      data: color,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteColorController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<ColorIdParam>(req, "params");

    await deleteColor(id);

    return res.status(200).json({
      success: true,
      message: "Color deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
