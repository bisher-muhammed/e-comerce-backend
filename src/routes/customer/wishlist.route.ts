import { Router } from "express";

import { authenticate } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";

import {
  addWishlistItemSchema,
  removeWishlistItemSchema,
} from "../../validations/customer/wishlist.validation";

import {
  getWishlistController,
  addWishlistItemController,
  removeWishlistItemController,
} from "../../controllers/customers/wishlist.controller"
const router = Router();


// GET USER WISHLIST
router.get(
  "/",
  authenticate,
  getWishlistController
);


// ADD PRODUCT TO WISHLIST
router.post(
  "/items",
  authenticate,
  validate({ body: addWishlistItemSchema }),
  addWishlistItemController
);


// REMOVE PRODUCT FROM WISHLIST
router.delete(
  "/items/:productId",
  authenticate,
  validate({ params: removeWishlistItemSchema }),
  removeWishlistItemController
);


export default router;