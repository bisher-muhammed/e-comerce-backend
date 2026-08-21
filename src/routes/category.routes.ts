import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { authorize } from "../middlewares/authorize.middleware";
import { validate } from "../middlewares/validate.middleware";

import {
  createCategoryController,
  listCategoriesController,
  getCategoryByIdController,
  updateCategoryController,
  blockCategoryController,
  unblockCategoryController,
  deleteCategoryController,
} from "../controllers/category.controller";

import {
  createCategorySchema,
  updateCategorySchema,
} from "../validations/category.validation";

const router = Router();

router.use(authenticate);
router.use(authorize("SUPER_ADMIN", "ADMIN"));

router.post(
  "/",
  validate({ body: createCategorySchema }),
  createCategoryController
);

router.get(
  "/",
  listCategoriesController
);

router.get(
  "/:id",
  getCategoryByIdController
);

router.patch(
  "/:id",
  validate({ body: updateCategorySchema }),
  updateCategoryController
);

router.patch(
  "/:id/block",
  blockCategoryController
);

router.patch(
  "/:id/unblock",
  unblockCategoryController
);

router.delete(
  "/:id",
  deleteCategoryController
);

export default router;
