import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";

import {
    orderIdSchema,
    orderItemParamsSchema,
    listOrdersSchema,
    cancelOrderSchema,
    cancelOrderItemSchema,
    returnOrderItemSchema,
    verifyPaymentSchema,
} from "../../validations/customer/order.validation";

import {
    getOrdersController,
    getOrderDetailsController,
    cancelOrderController,
    cancelOrderItemController,
    returnOrderItemController,
    verifyPaymentController,
} from "../../controllers/customers/order.controller";

const router = Router();

router.get("/", authenticate, validate({ query: listOrdersSchema }), getOrdersController);

router.get("/:orderId", authenticate, validate({ params: orderIdSchema }), getOrderDetailsController);

router.patch(
    "/:orderId/cancel",
    authenticate,
    validate({ params: orderIdSchema, body: cancelOrderSchema }),
    cancelOrderController
);

router.patch(
    "/:orderId/items/:itemId/cancel",
    authenticate,
    validate({ params: orderItemParamsSchema, body: cancelOrderItemSchema }),
    cancelOrderItemController
);

router.post(
    "/:orderId/items/:itemId/return",
    authenticate,
    validate({ params: orderItemParamsSchema, body: returnOrderItemSchema }),
    returnOrderItemController
);

router.post(
    "/:orderId/verify-payment",
    authenticate,
    validate({ params: orderIdSchema, body: verifyPaymentSchema }),
    verifyPaymentController
);

export default router;
