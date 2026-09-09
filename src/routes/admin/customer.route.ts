import { Router } from "express";

import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/authorize.middleware";
import { validate } from "../../middlewares/validate.middleware";

import {
  listCustomersController,
  getCustomerByIdController,
  updateCustomerStatusController,
} from "../../controllers/admin/customer.controller";

import { listCustomersSchema } from "../../validations/admin/listcustomer.validation";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    query: listCustomersSchema,
  }),
  listCustomersController
);


router.get(
  "/:id",
  authenticate,
  authorize("ADMIN", "SUPER_ADMIN"),
  getCustomerByIdController
);


router.patch(
  "/:id/status",
  authenticate,
  authorize("ADMIN", "SUPER_ADMIN"),
  updateCustomerStatusController
);

export default router;

