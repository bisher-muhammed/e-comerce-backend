// controllers/customers/cart.controller.ts

import { Request, Response } from "express";
import {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
} from "../../services/customer/cart.service";
import AppError from "../../errors/AppError";
import { validated } from "../../middlewares/validate.middleware";
import type {
  AddToCartInput,
  UpdateCartItemInput,
  CartItemParams,
} from "../../validations/customer/cart.validation";

const handleError = (res: Response, error: unknown) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
  }

  console.error(error);
  return res.status(500).json({
    success: false,
    message: "Something went wrong",
  });
};

export const addToCartController = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { productVariantId, quantity } = validated<AddToCartInput>(req, "body");
    const cartItem = await addToCart(req.user.id, productVariantId, quantity);

    return res.status(200).json({
      success: true,
      message: "Product added to cart",
      data: cartItem,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getCartController = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const cart = await getCart(req.user.id);

    return res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateCartItemController = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { cartItemId } = validated<CartItemParams>(req, "params");
    const { quantity } = validated<UpdateCartItemInput>(req, "body");

    const cartItem = await updateCartItem(req.user.id, cartItemId, quantity);

    return res.status(200).json({
      success: true,
      message: "Cart item updated",
      data: cartItem,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const removeCartItemController = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { cartItemId } = validated<CartItemParams>(req, "params");
    await removeCartItem(req.user.id, cartItemId);

    return res.status(200).json({
      success: true,
      message: "Cart item removed",
    });
  } catch (error) {
    return handleError(res, error);
  }
};
