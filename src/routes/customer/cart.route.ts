import { Router } from "express";

import { authenticate } from "../../middlewares/auth.middleware"
import { validate } from "../../middlewares/validate.middleware";
import {
  addToCartSchema,
  updateCartItemSchema,
  cartItemParamsSchema
  
} from "../../validations/customer/cart.validation";

import {
  addToCartController,
  updateCartItemController,
  removeCartItemController,
  getCartController
} from "../../controllers/customers/cart.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  getCartController
);

router.post(
  "/",
  authenticate,
  validate({ body: addToCartSchema }),
  addToCartController
);

router.patch(
  "/:cartItemId",
  authenticate,
  validate({ params: cartItemParamsSchema, body: updateCartItemSchema }),
  updateCartItemController
);

router.delete(
  "/:cartItemId",
  authenticate,
  validate({ params: cartItemParamsSchema }),
  removeCartItemController
);


export default router;
