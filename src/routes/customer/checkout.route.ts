import {Router} from "express";
import {authenticate} from "../../middlewares/auth.middleware";
import {validate} from "../../middlewares/validate.middleware";

import {
    checkoutSchema,
    verifyPaymentSchema
} from "../../validations/customer/checkout.validation";

import {
    createCheckoutController,
    verifyPaymentController
} from "../../controllers/customers/checkout.controller";


const router = Router();

// CREATE CHECKOUT
router.post(
    "/",
    authenticate,
    validate({body: checkoutSchema}),
    createCheckoutController
);

// VERIFY PAYMENT
router.post(
    "/verify",
    authenticate,
    validate({body: verifyPaymentSchema}),
    verifyPaymentController
);

export default router;
