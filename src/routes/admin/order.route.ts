import { Router } from "express";
import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { permitByMethod, requirePermission, requirePermissionWhen } from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";
import * as orderController from "../../controllers/admin/order.controller";
import {
  listOrdersQuerySchema,
  orderIdParamSchema,
  updateOrderStatusBodySchema,
  refundOrderBodySchema,
} from "../../validations/admin/order.validation";

const router = Router();

router.use(authenticateAdmin, permitByMethod("orders.read", "orders.update"));

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
  requirePermissionWhen(
    (req) => req.body?.status === "CANCELLED",
    "orders.cancel"
  ),
  orderController.updateOrderStatus
);

router.post(
  "/:orderId/refund",
  validate({ params: orderIdParamSchema }),
  validate({ body: refundOrderBodySchema }),
  requirePermission("orders.refund"),
  orderController.refundOrder
);

export default router;

