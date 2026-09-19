import { Router } from "express";

import { authenticateAdmin } from "../middlewares/auth.middleware";
import { permitByMethod } from "../middlewares/permission.middleware";
import { validate } from "../middlewares/validate.middleware";

import {
  createSizeController,
  listSizesController,
  getSizeByIdController,
  updateSizeController,
  deleteSizeController,
} from "../controllers/size.controller";

import {
  createSizeSchema,
  updateSizeSchema,
  sizeIdSchema,
} from "../validations/size.validation";

const router = Router();

router.use(authenticateAdmin);
router.use(permitByMethod("catalog.read", "catalog.write"));

router.post(
  "/",
  validate({ body: createSizeSchema }),
  createSizeController
);

router.get(
  "/",
  listSizesController
);

router.get(
  "/:id",
  validate({ params: sizeIdSchema }),
  getSizeByIdController
);

router.patch(
  "/:id",
  validate({
    params: sizeIdSchema,
    body: updateSizeSchema,
  }),
  updateSizeController
);

router.delete(
  "/:id",
  validate({ params: sizeIdSchema }),
  deleteSizeController
);

export default router;
