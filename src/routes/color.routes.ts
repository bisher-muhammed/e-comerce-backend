import { Router } from "express";

import { authenticateAdmin } from "../middlewares/auth.middleware";
import { permitByMethod } from "../middlewares/permission.middleware";
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
  colorIdSchema,
} from "../validations/color.validation";

const router = Router();

router.use(authenticateAdmin);
router.use(
  permitByMethod("catalog.read", "catalog.write")
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
  validate({ params: colorIdSchema }),
  getColorByIdController
);

router.patch(
  "/:id",
  validate({
    params: colorIdSchema,
    body: updateColorSchema,
  }),
  updateColorController
);

router.delete(
  "/:id",
  validate({ params: colorIdSchema }),
  deleteColorController
);

export default router;
