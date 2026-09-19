import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";

import {
  listCustomersController,
  getCustomerByIdController,
  updateCustomerStatusController,
} from "../../controllers/admin/customer.controller";

import {
  customerIdSchema,
  listCustomersSchema,
  updateCustomerStatusSchema,
} from "../../validations/admin/listcustomer.validation";

const router = Router();

router.get(
  "/",
  authenticateAdmin,
  requirePermission("customers.read"),
  validate({
    query: listCustomersSchema,
  }),
  listCustomersController
);


router.get(
  "/:id",
  authenticateAdmin,
  requirePermission("customers.read"),
  validate({
    params: customerIdSchema,
  }),
  getCustomerByIdController
);


router.patch(
  "/:id/status",
  authenticateAdmin,
  requirePermission("customers.suspend"),
  validate({
    params: customerIdSchema,
    body: updateCustomerStatusSchema,
  }),
  updateCustomerStatusController
);

export default router;
