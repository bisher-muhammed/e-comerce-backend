import { Request, Response } from "express";

import {
  getWishlist,
  addWishlistItem,
  removeWishlistItem,
} from "../../services/customer/wishlist.service";



// GET /wishlist
export const getWishlistController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user!.id;

  const wishlist = await getWishlist(userId);

  return res.status(200).json({
    success: true,
    data: wishlist,
  });
};


// POST /wishlist/items
export const addWishlistItemController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user!.id;

  const { productId } = req.body;

  const item = await addWishlistItem(
    userId,
    productId
  );

  return res.status(201).json({
    success: true,
    message: "Product added to wishlist",
    data: item,
  });
};


// DELETE /wishlist/items/:productId
export const removeWishlistItemController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user!.id;

  const productId = Number(req.params.productId);

  await removeWishlistItem(
    userId,
    productId
  );

  return res.status(200).json({
    success: true,
    message: "Product removed from wishlist",
  });
};
