import { z } from "zod";

export const orderIdSchema = z.object({
    orderId: z.coerce.number().int().positive(),
});

export const orderItemParamsSchema = z.object({
    orderId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
});

export const listOrdersSchema = z
    .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(10),

        status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "DELIVERED"]).optional(),

        // matches numeric order id, or product name inside the order's items
        search: z.string().trim().min(1).max(100).optional(),

        dateField: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
    })
    .refine((d) => !d.startDate || !d.endDate || d.startDate <= d.endDate, {
        message: "startDate must be before endDate",
        path: ["startDate"],
    });

const idempotencyBodySchema = z.object({
    idempotencyKey: z.string().trim().min(1, "idempotencyKey is required").max(100),
});

// ORDER-LEVEL CANCEL — one key for the whole order
export const cancelOrderSchema = idempotencyBodySchema;

// ITEM-LEVEL CANCEL — quantity + key scoped to that item
export const cancelOrderItemSchema = idempotencyBodySchema.extend({
    quantity: z.coerce.number().int().positive(),
});

// ITEM-LEVEL RETURN — quantity + reason + key scoped to that item
export const returnOrderItemSchema = idempotencyBodySchema.extend({
    quantity: z.coerce.number().int().positive(),
    reason: z.string().trim().min(5, "Return reason must be at least 5 characters").max(500),
});

export const verifyPaymentSchema = z.object({
    orderId: z.coerce.number().int().positive(),
    razorpayPaymentId: z.string().trim().min(1, "Razorpay payment ID is required"),
    razorpaySignature: z.string().trim().min(1, "Razorpay signature is required"),
});
