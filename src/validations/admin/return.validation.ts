import { z } from "zod";

export const listReturnsQuerySchema = z.object({
  status: z
    .enum(["REQUESTED", "APPROVED", "REJECTED", "RECEIVED", "REFUNDED"])
    .optional(),

  page: z.coerce.number().int().positive().max(100_000).default(1),

  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const returnIdParamSchema = z.object({
  returnId: z.coerce.number().int().positive().max(2_147_483_647),
});

export const returnNoteBodySchema = z.object({
  note: z.string().trim().min(1).max(500).optional(),
});

export const rejectReturnBodySchema = z.object({
  note: z
    .string()
    .trim()
    .min(5, "A rejection reason of at least 5 characters is required")
    .max(500),
});

export const manualRefundBodySchema = z.object({
  reference: z
    .string()
    .trim()
    .min(3, "A payment reference is required")
    .max(200),
});

export type ListReturnsQuery = z.infer<typeof listReturnsQuerySchema>;
export type ReturnIdParam = z.infer<typeof returnIdParamSchema>;
export type ReturnNoteBody = z.infer<typeof returnNoteBodySchema>;
export type RejectReturnBody = z.infer<typeof rejectReturnBodySchema>;
export type ManualRefundBody = z.infer<typeof manualRefundBodySchema>;
