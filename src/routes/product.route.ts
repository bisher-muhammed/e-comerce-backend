import { Router } from "express";

import { authenticateAdmin } from "../middlewares/auth.middleware";
import { permitByMethod } from "../middlewares/permission.middleware";
import { validate } from "../middlewares/validate.middleware";

import {
  create,
  list,
  getById,
  update,
  remove,
} from "../controllers/product.controller";

import {
  productIdSchema,
  listProductsQuerySchema,
} from "../validations/product.validation";

import {
  MAX_PRODUCT_IMAGE_FILES,
  productImageUpload,
  verifyImageContents,
} from "../middlewares/upload.middleware";

const router = Router();


router.use(authenticateAdmin);
router.use(permitByMethod("catalog.read", "catalog.write"));


router.post(
  "/",
  productImageUpload.array(
    "images",
    MAX_PRODUCT_IMAGE_FILES
  ),
  verifyImageContents,
  create
);


router.get(
  "/",
  validate({
    query: listProductsQuerySchema,
  }),
  list
);


router.get(
  "/:id",
  validate({
    params: productIdSchema,
  }),
  getById
);


router.patch(
  "/:id",
  validate({
    params: productIdSchema,
  }),
  productImageUpload.array(
    "images",
    MAX_PRODUCT_IMAGE_FILES
  ),
  verifyImageContents,
  update
);


router.delete(
  "/:id",
  validate({
    params: productIdSchema,
  }),
  remove
);

export default router;