import { Router } from "express";

import { authenticate } from "../middlewares/auth.middleware";
import { authorize } from "../middlewares/authorize.middleware";
import { validate } from "../middlewares/validate.middleware";

import {
  createColorController,
  listColorsController,
  getColorByIdController,
  updateColorController,
  deleteColorController,
} from "../controllers/color.controller";

import {
  createColorSchema,
  updateColorSchema,
} from "../validations/color.validation";

const router = Router();

router.use(authenticate);
router.use(
  authorize("SUPER_ADMIN", "ADMIN")
);

router.post(
  "/",
  validate({ body: createColorSchema }),
  createColorController
);

router.get(
  "/",
  listColorsController
);

router.get(
  "/:id",
  getColorByIdController
);

router.patch(
  "/:id",
  validate({ body: updateColorSchema }),
  updateColorController
);

router.delete(
  "/:id",
  deleteColorController
);

export default router;
