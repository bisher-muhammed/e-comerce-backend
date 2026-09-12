import { Router } from "express";

import { authenticate } from "../middlewares/auth.middleware";
import { authorize } from "../middlewares/authorize.middleware";
import { validate } from "../middlewares/validate.middleware";

import {
  createAdminController,
  listAdminsController,
  getAdminByIdController,
} from "../controllers/admin.controller";

import {
  createAdminSchema,
  adminIdSchema,
} from "../validations/admin.validation";

const router = Router();

router.post(
  "/admins",
  authenticate,
  authorize("SUPER_ADMIN"),
  validate({ body: createAdminSchema }),
  createAdminController
);

router.get(
  "/admins",
  authenticate,
  authorize("SUPER_ADMIN"),
  listAdminsController
);

router.get(
  "/admins/:id",
  authenticate,
  authorize("SUPER_ADMIN"),
  validate({ params: adminIdSchema }),
  getAdminByIdController
);

export default router;
