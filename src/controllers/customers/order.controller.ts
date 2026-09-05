import { Request, Response, NextFunction } from "express";

import {
    getOrderByIdForUser,
    listOrdersForUser,
    cancelOrder,
    cancelOrderItem,
    returnOrderItem,
    verifyPayment,
} from "../../services/customer/order.service";

import {
    orderIdSchema,
    orderItemParamsSchema,
    listOrdersSchema,
    cancelOrderSchema,
    cancelOrderItemSchema,
    returnOrderItemSchema,
    verifyPaymentSchema,
} from "../../validations/customer/order.validation";

export async function getOrdersController(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.id;
        const q = listOrdersSchema.parse(req.query);

        const orders = await listOrdersForUser(userId, q.page, q.limit, {
            status: q.status,
            search: q.search,
            dateField: q.dateField,
            startDate: q.startDate,
            endDate: q.endDate,
        });

        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        next(error);
    }
}

export async function getOrderDetailsController(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.id;
        const { orderId } = orderIdSchema.parse(req.params);
        const order = await getOrderByIdForUser(orderId, userId);
        res.status(200).json({ success: true, data: order });
    } catch (error) {
        next(error);
    }
}

// ORDER-LEVEL CANCEL
export async function cancelOrderController(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.id;
        const { orderId } = orderIdSchema.parse(req.params);
        const { idempotencyKey } = cancelOrderSchema.parse(req.body);

        const order = await cancelOrder(orderId, userId, idempotencyKey);

        res.status(200).json({ success: true, message: "Order cancelled successfully", data: order });
    } catch (error) {
        next(error);
    }
}

// ITEM-LEVEL CANCEL
export async function cancelOrderItemController(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.id;
        const { orderId, itemId } = orderItemParamsSchema.parse(req.params);
        const { quantity, idempotencyKey } = cancelOrderItemSchema.parse(req.body);

        const item = await cancelOrderItem(orderId, itemId, userId, quantity, idempotencyKey);

        res.status(200).json({ success: true, message: "Item cancelled successfully", data: item });
    } catch (error) {
        next(error);
    }
}

// ITEM-LEVEL RETURN
export async function returnOrderItemController(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.id;
        const { orderId, itemId } = orderItemParamsSchema.parse(req.params);
        const { quantity, reason, idempotencyKey } = returnOrderItemSchema.parse(req.body);

        const item = await returnOrderItem(orderId, itemId, userId, quantity, reason, idempotencyKey);

        res.status(200).json({ success: true, message: "Return requested successfully", data: item });
    } catch (error) {
        next(error);
    }
}

export async function verifyPaymentController(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = req.user!.id;
        const validatedData = verifyPaymentSchema.parse({ ...req.body, orderId: req.params.orderId });

        const order = await verifyPayment(
            validatedData.orderId,
            userId,
            validatedData.razorpayPaymentId,
            validatedData.razorpaySignature
        );

        res.status(200).json({ success: true, message: "Payment verified successfully", data: order });
    } catch (error) {
        next(error);
    }
}
