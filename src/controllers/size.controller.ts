import {
  Request,
  Response,
  NextFunction,
} from "express";

import {
  createSize,
  listSizes,
  getSizeById,
  updateSize,
  deleteSize,
} from "../services/admin/size.service";

export const createSizeController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const size = await createSize(req.body);

    return res.status(201).json({
      success: true,
      message: "Size created successfully",
      data: size,
    });
  } catch (error) {
    next(error);
  }
};

export const listSizesController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const sizes = await listSizes();

    return res.status(200).json({
      success: true,
      data: sizes,
    });
  } catch (error) {
    next(error);
  }
};

export const getSizeByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = Number(req.params.id);

    const size = await getSizeById(id);

    return res.status(200).json({
      success: true,
      data: size,
    });
  } catch (error) {
    next(error);
  }
};

export const updateSizeController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = Number(req.params.id);

    const size = await updateSize(
      id,
      req.body
    );

    return res.status(200).json({
      success: true,
      message: "Size updated successfully",
      data: size,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteSizeController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = Number(req.params.id);

    await deleteSize(id);

    return res.status(200).json({
      success: true,
      message: "Size deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
