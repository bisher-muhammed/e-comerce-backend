import { Router } from "express";

import { authenticate } from "../middlewares/auth.middleware";
import { authorize } from "../middlewares/authorize.middleware";
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

router.use(authenticate);
router.use(authorize("SUPER_ADMIN", "ADMIN"));

router.use((req, res, next) => {
  console.log("SIZE ROUTER HIT:", req.method, req.originalUrl);
  next();
});

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
