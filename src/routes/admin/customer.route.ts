import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/authorize.middleware";
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
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    query: listCustomersSchema,
  }),
  listCustomersController
);


router.get(
  "/:id",
  authenticateAdmin,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    params: customerIdSchema,
  }),
  getCustomerByIdController
);


router.patch(
  "/:id/status",
  authenticateAdmin,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    params: customerIdSchema,
    body: updateCustomerStatusSchema,
  }),
  updateCustomerStatusController
);

export default router;
