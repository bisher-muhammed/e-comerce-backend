import { Request, Response, NextFunction } from "express";

import { getProducts,getProductBySlug } from "../../services/customer/product.service";
import AppError from "../../errors/AppError";

export const getProductController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const products = await getProducts();

    return res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    next(error);
  }
};


export const getProductBySlugController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { slug } = req.params;

    if (typeof slug !== "string") {
      throw new AppError("Invalid product slug", 400);
    }

    const product = await getProductBySlug(slug);

    if (!product) {
      throw new AppError(
        "Product not found",
        404
      );
    }

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    next(error);
  }
};