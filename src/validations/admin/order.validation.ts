import { z } from "zod";

import {
    OrderStatus,
    PaymentStatus,
    PaymentMethod,
} from "../../../generated/prisma/enums";

// ============================================================
// LIST ORDERS
// ============================================================

export const listOrdersQuerySchema = z.object({
    page: z.coerce
        .number()
        .int()
        .positive()
        .default(1),

    limit: z.coerce
        .number()
        .int()
        .positive()
        .max(100)
        .default(20),

    status: z.nativeEnum(OrderStatus).optional(),

    paymentStatus:
        z.nativeEnum(PaymentStatus).optional(),

    paymentMethod:
        z.nativeEnum(PaymentMethod).optional(),

    search: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional(),

    sortBy: z
        .enum([
            "createdAt",
            "total",
            "status",
        ])
        .default("createdAt"),

    sortOrder: z
        .enum(["asc", "desc"])
        .default("desc"),
});

export type ListOrdersQuery =
    z.infer<typeof listOrdersQuerySchema>;

// ============================================================
// ORDER ID
// ============================================================

export const orderIdParamSchema = z.object({
    orderId: z.coerce
        .number()
        .int()
        .positive(),
});

export type OrderIdParam =
    z.infer<typeof orderIdParamSchema>;

// ============================================================
// UPDATE ORDER STATUS
// ============================================================

export const updateOrderStatusBodySchema =
    z
        .object({
            status: z.nativeEnum(OrderStatus),

            reason: z
                .string()
                .trim()
                .max(500)
                .optional(),

            idempotencyKey: z
                .string()
                .trim()
                .min(
                    1,
                    "idempotencyKey is required"
                )
                .max(100),
        })
        .superRefine((data, ctx) => {
            if (
                data.status ===
                    OrderStatus.CANCELLED &&
                (!data.reason ||
                    data.reason.length < 5)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        "A reason of at least 5 characters is required when cancelling an order",
                    path: ["reason"],
                });
            }
        });

export type UpdateOrderStatusBody =
    z.infer<
        typeof updateOrderStatusBodySchema
    >;
