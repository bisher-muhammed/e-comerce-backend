import { Router } from "express";

import { authenticateAdmin } from "../middlewares/auth.middleware";
import { authorize } from "../middlewares/authorize.middleware";
import { validate } from "../middlewares/validate.middleware";

import {
  createAdminController,
  listAdminsController,
  getAdminByIdController,
  setAdminStatusController,
  removeAdminController,
  forceLogoutAdminController,
  resetAdminMfaController,
  listPermissionsController,
  setAdminPermissionsController,
  listAuditLogsController,
} from "../controllers/admin.controller";
import { requirePermission } from "../middlewares/permission.middleware";

import {
  createAdminSchema,
  adminIdSchema,
  adminStatusSchema,
  adminPermissionsSchema,
  listAuditLogsQuerySchema,
} from "../validations/admin.validation";

const router = Router();

router.post(
  "/admins",
  authenticateAdmin,
  authorize("SUPER_ADMIN"),
  validate({ body: createAdminSchema }),
  createAdminController
);

router.get(
  "/admins",
  authenticateAdmin,
  authorize("SUPER_ADMIN"),
  listAdminsController
);

router.get(
  "/admins/:id",
  authenticateAdmin,
  authorize("SUPER_ADMIN"),
  validate({ params: adminIdSchema }),
  getAdminByIdController
);

router.patch(
  "/admins/:id/status",
  authenticateAdmin,
  authorize("SUPER_ADMIN"),
  validate({ params: adminIdSchema, body: adminStatusSchema }),
  setAdminStatusController
);

router.delete(
  "/admins/:id",
  authenticateAdmin,
  authorize("SUPER_ADMIN"),
  validate({ params: adminIdSchema }),
  removeAdminController
);

router.post(
  "/admins/:id/logout",
  authenticateAdmin,
  authorize("SUPER_ADMIN"),
  validate({ params: adminIdSchema }),
  forceLogoutAdminController
);

router.post(
  "/admins/:id/mfa/reset",
  authenticateAdmin,
  authorize("SUPER_ADMIN"),
  validate({ params: adminIdSchema }),
  resetAdminMfaController
);

router.get(
  "/permissions",
  authenticateAdmin,
  authorize("SUPER_ADMIN"),
  listPermissionsController
);

router.put(
  "/admins/:id/permissions",
  authenticateAdmin,
  authorize("SUPER_ADMIN"),
  validate({ params: adminIdSchema, body: adminPermissionsSchema }),
  setAdminPermissionsController
);

router.get(
  "/audit-logs",
  authenticateAdmin,
  requirePermission("audit.view"),
  validate({ query: listAuditLogsQuerySchema }),
  listAuditLogsController
);

export default router;
