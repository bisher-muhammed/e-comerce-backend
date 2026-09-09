import { Request, Response, NextFunction } from "express";
import {
  listOrdersQuerySchema,
  orderIdParamSchema,
  updateOrderStatusBodySchema,
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
    const { status, reason } = updateOrderStatusBodySchema.parse(req.body);

    const order = await orderService.updateOrderStatus(orderId, status, reason);

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
};