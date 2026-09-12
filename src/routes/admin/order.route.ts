import { Router } from "express";
import { authenticateAdmin } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/authorize.middleware";
import { validate } from "../../middlewares/validate.middleware";
import * as orderController from "../../controllers/admin/order.controller";
import {
  listOrdersQuerySchema,
  orderIdParamSchema,
  updateOrderStatusBodySchema,
  refundOrderBodySchema,
} from "../../validations/admin/order.validation";

const router = Router();

router.use(authenticateAdmin, authorize("ADMIN", "SUPER_ADMIN"));

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

router.post(
  "/:orderId/refund",
  validate({ params: orderIdParamSchema }),
  validate({ body: refundOrderBodySchema }),
  orderController.refundOrder
);

export default router;

