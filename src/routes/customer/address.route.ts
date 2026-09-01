import { Router } from "express";

import { authenticate } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";

import {
  createAddressSchema,
  updateAddressSchema,
  addressIdSchema,
} from "../../validations/customer/address.validation";

import {
  getAddressesController,
  getAddressController,
  createAddressController,
  updateAddressController,
  deleteAddressController,
  setDefaultAddressController,
} from "../../controllers/customers/address.controller";

const router = Router();

// All address routes require authentication
router.use(authenticate);


// GET ALL ADDRESSES

router.get(
  "/",
  getAddressesController
);


// GET SINGLE ADDRESS

router.get(
  "/:id",
  validate({
    params: addressIdSchema,
  }),
  getAddressController
);


// CREATE ADDRESS

router.post(
  "/",
  validate({
    body: createAddressSchema,
  }),
  createAddressController
);


// SET DEFAULT ADDRESS

router.patch(
  "/:id/default",
  validate({
    params: addressIdSchema,
  }),
  setDefaultAddressController
);


// UPDATE ADDRESS

router.patch(
  "/:id",
  validate({
    params: addressIdSchema,
    body: updateAddressSchema,
  }),
  updateAddressController
);


// DELETE ADDRESS

router.delete(
  "/:id",
  validate({
    params: addressIdSchema,
  }),
  deleteAddressController
);


export default router;
