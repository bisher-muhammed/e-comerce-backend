// controllers/customers/cart.controller.ts

import { NextFunction, Request, Response } from "express";
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

const requireUser = (req: Request) => {
  if (!req.user) {
    throw new AppError("Unauthorized", 401);
  }

  return req.user;
};

export const addToCartController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = requireUser(req);
    const { productVariantId, quantity } = validated<AddToCartInput>(req, "body");
    const cartItem = await addToCart(user.id, productVariantId, quantity);

    return res.status(200).json({
      success: true,
      message: "Product added to cart",
      data: cartItem,
    });
  } catch (error) {
    next(error);
  }
};

export const getCartController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const cart = await getCart(requireUser(req).id);

    return res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCartItemController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = requireUser(req);
    const { cartItemId } = validated<CartItemParams>(req, "params");
    const { quantity } = validated<UpdateCartItemInput>(req, "body");

    const cartItem = await updateCartItem(user.id, cartItemId, quantity);

    return res.status(200).json({
      success: true,
      message: "Cart item updated",
      data: cartItem,
    });
  } catch (error) {
    next(error);
  }
};

export const removeCartItemController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = requireUser(req);
    const { cartItemId } = validated<CartItemParams>(req, "params");
    await removeCartItem(user.id, cartItemId);

    return res.status(200).json({
      success: true,
      message: "Cart item removed",
    });
  } catch (error) {
    next(error);
  }
};
