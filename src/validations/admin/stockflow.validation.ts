import { z } from "zod";
import { StockMovementType } from "../../../generated/prisma/enums";

export const variantIdParamSchema = z.object({
  variantId: z.coerce.number().int().positive(),
});
export type VariantIdParam = z.infer<typeof variantIdParamSchema>;

export const restockSchema = z.object({
  quantity: z.number().int().positive("Quantity must be a positive integer"),
  supplierName: z.string().trim().min(1).max(200).optional(),
  unitCost: z.number().positive().optional(),
  batchNumber: z.string().trim().max(100).optional(),
});
export type RestockBody = z.infer<typeof restockSchema>;

export const manualAdjustmentSchema = z.object({
  newStock: z.number().int().nonnegative("Stock cannot be negative"),
  reason: z.string().trim().min(5, "Reason must be at least 5 characters"),
});
export type ManualAdjustmentBody = z.infer<typeof manualAdjustmentSchema>;

export const listStockMovementsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;
