import { z } from "zod";

// ============================================================
// COMMON
// ============================================================

const idempotencyBodySchema = z.object({
    idempotencyKey: z
        .string()
        .trim()
        .min(1, "idempotencyKey is required")
        .max(100),
});

// ============================================================
// ORDER ID
// ============================================================

export const orderIdSchema = z.object({
    orderId: z.coerce
        .number()
        .int()
        .positive(),
});

// ============================================================
// ORDER + ITEM PARAMS
// ============================================================

export const orderItemParamsSchema = z.object({
    orderId: z.coerce
        .number()
        .int()
        .positive(),

    itemId: z.coerce
        .number()
        .int()
        .positive(),
});

// ============================================================
// LIST ORDERS
// ============================================================

export const listOrdersSchema = z
    .object({
        page: z.coerce
            .number()
            .int()
            .min(1)
            .default(1),

        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(50)
            .default(10),

        status: z
            .enum([
                "PENDING",
                "CONFIRMED",
                "CANCELLED",
                "DELIVERED",
            ])
            .optional(),

        search: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .optional(),

        dateField: z
            .enum(["createdAt", "updatedAt"])
            .default("createdAt"),

        startDate: z.coerce.date().optional(),

        endDate: z.coerce.date().optional(),
    })
    .refine(
        (data) =>
            !data.startDate ||
            !data.endDate ||
            data.startDate <= data.endDate,
        {
            message: "startDate must be before endDate",
            path: ["startDate"],
        }
    );

// ============================================================
// CANCEL ENTIRE ORDER
// ============================================================

export const cancelOrderSchema =
    idempotencyBodySchema.extend({
        reason: z
            .string()
            .trim()
            .max(500)
            .optional(),
    });

// ============================================================
// CANCEL ORDER ITEM
// ============================================================

export const cancelOrderItemSchema =
    idempotencyBodySchema.extend({
        quantity: z.coerce
            .number()
            .int()
            .positive(),

        reason: z
            .string()
            .trim()
            .max(500)
            .optional(),
    });

// ============================================================
// RETURN ORDER ITEM
// ============================================================

export const returnOrderItemSchema =
    idempotencyBodySchema.extend({
        quantity: z.coerce
            .number()
            .int()
            .positive(),

        reason: z
            .string()
            .trim()
            .min(
                5,
                "Return reason must be at least 5 characters"
            )
            .max(500),
    });

// ============================================================
// VERIFY ONLINE PAYMENT
// ============================================================

export const verifyPaymentSchema = z.object({
    orderId: z.coerce
        .number()
        .int()
        .positive(),

    razorpayPaymentId: z
        .string()
        .trim()
        .min(
            1,
            "Razorpay payment ID is required"
        ),

    razorpaySignature: z
        .string()
        .trim()
        .min(
            1,
            "Razorpay signature is required"
        ),
});
