import { Request, Response, NextFunction } from "express";
import {
  listOrdersQuerySchema,
  orderIdParamSchema,
  updateOrderStatusBodySchema,
  refundOrderBodySchema,
} from "../../validations/admin/order.validation";
import * as orderService from "../../services/admin/order.service";

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listOrdersQuerySchema.parse(req.query);
    const result = await orderService.listOrders(query);

    // Stays "orders" (plural) — matches OrderListResponse on the frontend.
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = orderIdParamSchema.parse(req.params);
    const order = await orderService.getOrderDetails(orderId);

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = orderIdParamSchema.parse(req.params);
    const { status, reason, idempotencyKey } = updateOrderStatusBodySchema.parse(req.body);

    const order = await orderService.updateOrderStatus(
      orderId,
      status,
      reason,
      idempotencyKey
    );

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
};

export const refundOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = orderIdParamSchema.parse(req.params);
    const { idempotencyKey, reason } = refundOrderBodySchema.parse(req.body);

    const { order, refund } = await orderService.refundOrder(
      orderId,
      idempotencyKey,
      reason
    );

    res.status(refund.status === "FAILED" ? 502 : 200).json({
      success: refund.status !== "FAILED",
      data: { order, refund },
    });
  } catch (error) {
    next(error);
  }
};