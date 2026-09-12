import { z } from "zod";
export const createColorSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Color name must be at least 2 characters")
    .max(50, "Color name is too long"),

  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(50, "Slug is too long")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must contain only lowercase letters, numbers, and hyphens"
    ),

  hexCode: z
    .string()
    .trim()
    .regex(
      /^#[0-9A-Fa-f]{6}$/,
      "Hex code must be in the format #RRGGBB"
    )
    .optional(),
});

export const updateColorSchema = createColorSchema.partial();

export const colorIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type CreateColorInput = z.infer<
  typeof createColorSchema
>;

export type UpdateColorInput = z.infer<
  typeof updateColorSchema
>;

export type ColorIdParam = z.infer<
  typeof colorIdSchema
>;
