import { z } from "zod";

// ============================================================
// LIST PRODUCTS
// ============================================================

export const listProductsQuerySchema = z.object({
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

    categoryId: z.coerce
        .number()
        .int()
        .positive()
        .optional(),
});

export type ListProductsQuery =
    z.infer<typeof listProductsQuerySchema>;
