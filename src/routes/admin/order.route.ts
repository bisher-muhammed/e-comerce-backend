import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/authorize.middleware";
import { validate } from "../../middlewares/validate.middleware";
import * as orderController from "../../controllers/admin/order.controller";
import {
  listOrdersQuerySchema,
  orderIdParamSchema,
  updateOrderStatusBodySchema,
} from "../../validations/admin/order.validation";

const router = Router();

router.use(authenticate, authorize("ADMIN", "SUPER_ADMIN"));

router.get(
  "/",
  validate({ query: listOrdersQuerySchema }),
  orderController.listOrders
);

router.get(
  "/:orderId",
  validate({ params: orderIdParamSchema }),
  orderController.getOrderDetails
);

router.patch(
  "/:orderId/status",
  validate({ params: orderIdParamSchema }),
  validate({ body: updateOrderStatusBodySchema }),
  orderController.updateOrderStatus
);

export default router;

