import {
    Request,
    Response,
    NextFunction,
} from "express";

import {
    getOrderByIdForUser,
    listOrdersForUser,
    cancelOrder,
    cancelOrderItem,
    returnOrderItem,
    verifyPayment,
} from "../../services/customer/order.service";

import { validated } from "../../middlewares/validate.middleware";

import type {
    OrderIdParam,
    OrderItemParams,
    ListOrdersInput,
    CancelOrderInput,
    CancelOrderItemInput,
    ReturnOrderItemInput,
    VerifyPaymentBody,
} from "../../validations/customer/order.validation";

// ============================================================
// GET ORDERS
// ============================================================

export async function getOrdersController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.id;

        const q = validated<ListOrdersInput>(
            req,
            "query"
        );

        const orders =
            await listOrdersForUser(
                userId,
                q.page,
                q.limit,
                {
                    status: q.status,
                    search: q.search,
                    dateField: q.dateField,
                    startDate: q.startDate,
                    endDate: q.endDate,
                }
            );

        res.status(200).json({
            success: true,
            data: orders,
        });
    } catch (error) {
        next(error);
    }
}

// ============================================================
// GET ORDER DETAILS
// ============================================================

export async function getOrderDetailsController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.id;

        const { orderId } =
            validated<OrderIdParam>(
                req,
                "params"
            );

        const order =
            await getOrderByIdForUser(
                orderId,
                userId
            );

        res.status(200).json({
            success: true,
            data: order,
        });
    } catch (error) {
        next(error);
    }
}

// ============================================================
// CANCEL ENTIRE ORDER
// ============================================================

export async function cancelOrderController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.id;

        const { orderId } =
            validated<OrderIdParam>(
                req,
                "params"
            );

        const {
            idempotencyKey,
            reason,
        } = validated<CancelOrderInput>(
            req,
            "body"
        );

        const order = await cancelOrder(
            orderId,
            userId,
            idempotencyKey,
            reason
        );

        res.status(200).json({
            success: true,
            message:
                "Order cancelled successfully",
            data: order,
        });
    } catch (error) {
        next(error);
    }
}

// ============================================================
// CANCEL ORDER ITEM
// ============================================================

export async function cancelOrderItemController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.id;

        const {
            orderId,
            itemId,
        } = validated<OrderItemParams>(
            req,
            "params"
        );

        const {
            quantity,
            idempotencyKey,
            reason,
        } = validated<CancelOrderItemInput>(
            req,
            "body"
        );

        const item =
            await cancelOrderItem(
                orderId,
                itemId,
                userId,
                quantity,
                idempotencyKey,
                reason
            );

        res.status(200).json({
            success: true,
            message:
                "Item cancelled successfully",
            data: item,
        });
    } catch (error) {
        next(error);
    }
}

// ============================================================
// RETURN ORDER ITEM
// ============================================================

export async function returnOrderItemController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.id;

        const {
            orderId,
            itemId,
        } = validated<OrderItemParams>(
            req,
            "params"
        );

        const {
            quantity,
            reason,
            idempotencyKey,
        } = validated<ReturnOrderItemInput>(
            req,
            "body"
        );

        const item =
            await returnOrderItem(
                orderId,
                itemId,
                userId,
                quantity,
                reason,
                idempotencyKey
            );

        res.status(200).json({
            success: true,
            message:
                "Return requested successfully",
            data: item,
        });
    } catch (error) {
        next(error);
    }
}

// ============================================================
// VERIFY PAYMENT
// ============================================================

export async function verifyPaymentController(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.id;

        const { orderId } =
            validated<OrderIdParam>(
                req,
                "params"
            );

        const {
            razorpayPaymentId,
            razorpaySignature,
        } = validated<VerifyPaymentBody>(
            req,
            "body"
        );

        const order =
            await verifyPayment(
                orderId,
                userId,
                razorpayPaymentId,
                razorpaySignature
            );

        res.status(200).json({
            success: true,
            message:
                "Payment verified successfully",
            data: order,
        });
    } catch (error) {
        next(error);
    }
}
