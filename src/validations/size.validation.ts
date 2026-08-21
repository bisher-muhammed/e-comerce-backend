import { z } from "zod";

export const createSizeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Size name is required")
    .max(50, "Size name is too long")
    .transform((value) => value.toUpperCase()),

  sortOrder: z
    .number()
    .int("Sort order must be an integer")
    .min(0, "Sort order cannot be negative")
    .default(0),
});

export const updateSizeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Size name is required")
    .max(50, "Size name is too long")
    .transform((value) => value.toUpperCase())
    .optional(),

  sortOrder: z
    .number()
    .int("Sort order must be an integer")
    .min(0, "Sort order cannot be negative")
    .optional(),
});

export const sizeIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type CreateSizeInput =
  z.infer<typeof createSizeSchema>;

export type UpdateSizeInput =
  z.infer<typeof updateSizeSchema>;