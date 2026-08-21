import { Router } from "express";

import { authenticate } from "../middlewares/auth.middleware";
import { authorize } from "../middlewares/authorize.middleware";
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
} from "../validations/product.validation";

import {
  productImageUpload,
} from "../middlewares/upload.middleware";

const router = Router();


router.use(authenticate);
router.use(authorize("SUPER_ADMIN", "ADMIN"));


router.post(
  "/",
  productImageUpload.array("images", 200),
  create
);


router.get(
  "/",
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
  productImageUpload.array("images", 200),
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