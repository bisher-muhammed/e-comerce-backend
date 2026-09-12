import { Router } from "express";
import { authenticateAdmin } from "../middlewares/auth.middleware";
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
  categoryIdSchema,
} from "../validations/category.validation";

const router = Router();

router.use(authenticateAdmin);
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
  validate({ params: categoryIdSchema }),
  getCategoryByIdController
);

router.patch(
  "/:id",
  validate({
    params: categoryIdSchema,
    body: updateCategorySchema,
  }),
  updateCategoryController
);

router.patch(
  "/:id/block",
  validate({ params: categoryIdSchema }),
  blockCategoryController
);

router.patch(
  "/:id/unblock",
  validate({ params: categoryIdSchema }),
  unblockCategoryController
);

router.delete(
  "/:id",
  validate({ params: categoryIdSchema }),
  deleteCategoryController
);

export default router;
