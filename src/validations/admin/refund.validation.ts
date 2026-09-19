import { z } from "zod";

export const listRefundsQuerySchema = z.object({
  status: z.enum(["PENDING", "PROCESSED", "FAILED"]).optional(),

  page: z.coerce.number().int().positive().max(100_000).default(1),

  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const refundIdParamSchema = z.object({
  refundId: z.coerce.number().int().positive().max(2_147_483_647),
});

export const retryRefundBodySchema = z.object({
  idempotencyKey: z
    .string()
    .trim()
    .min(1, "idempotencyKey is required")
    .max(100),
});

export type ListRefundsQuery = z.infer<typeof listRefundsQuerySchema>;
export type RefundIdParam = z.infer<typeof refundIdParamSchema>;
export type RetryRefundBody = z.infer<typeof retryRefundBodySchema>;
