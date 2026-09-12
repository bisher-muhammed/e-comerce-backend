import { z } from "zod";



const newProductImageSchema = z.object({
  fileIndex: z
    .number()
    .int("File index must be a whole number")
    .min(0, "File index cannot be negative"),

  altText: z
    .string()
    .trim()
    .max(255, "Alt text is too long")
    .optional()
    .or(z.literal("")),

  sortOrder: z
    .number()
    .int("Sort order must be a whole number")
    .min(0, "Sort order cannot be negative")
    .optional(),

  isPrimary: z
    .boolean()
    .optional(),
});


const existingProductImageSchema = z.object({
  existing: z.literal(true),

  id: z
    .number()
    .int("Image ID must be a whole number")
    .positive("Invalid image ID"),

  altText: z
    .string()
    .trim()
    .max(255, "Alt text is too long")
    .optional()
    .or(z.literal("")),

  sortOrder: z
    .number()
    .int("Sort order must be a whole number")
    .min(0, "Sort order cannot be negative")
    .optional(),

  isPrimary: z
    .boolean()
    .optional(),
});



const createProductImageSchema =
  newProductImageSchema;



const updateProductImageSchema = z.union([
  existingProductImageSchema,
  newProductImageSchema,
]);



const exactlyOnePrimaryImage = <T extends { isPrimary?: boolean }>(
  images: T[]
): boolean => images.filter((image) => image.isPrimary === true).length === 1;



const productVariantSchema = z.object({
  sizeId: z
    .number()
    .int("Size ID must be a whole number")
    .positive("Invalid size"),

  price: z
    .number()
    .finite("Price must be a valid number")
    .positive("Price must be greater than 0")
    .max(99999999.99, "Price is too high")
    .refine(
      (val) => Math.abs(Math.round(val * 100) - val * 100) < 1e-9,
      "Price can have at most 2 decimal places"
    ),

  stock: z
    .number()
    .int("Stock must be a whole number")
    .min(0, "Stock cannot be negative")
    .max(1000000, "Stock is too high"),
});



const createProductColorSchema = z.object({
  colorId: z
    .number()
    .int("Color ID must be a whole number")
    .positive("Invalid color"),

  images: z
    .array(createProductImageSchema)
    .min(1, "At least one image is required for each color")
    .max(10, "Maximum 10 images allowed per color")
    .refine(exactlyOnePrimaryImage, {
      message: "Each color must have exactly one primary image",
    }),

  variants: z
    .array(productVariantSchema)
    .min(1, "At least one size variant is required for each color")
    .max(50, "Maximum 50 variants allowed per color")
    .refine(
      (variants) =>
        new Set(variants.map((v) => v.sizeId)).size === variants.length,
      { message: "Duplicate sizes are not allowed for the same color" }
    ),
});



const updateProductColorSchema = z.object({
  colorId: z
    .number()
    .int("Color ID must be a whole number")
    .positive("Invalid color"),

  images: z
    .array(updateProductImageSchema)
    .min(1, "At least one image is required for each color")
    .max(10, "Maximum 10 images allowed per color")
    .refine(exactlyOnePrimaryImage, {
      message: "Each color must have exactly one primary image",
    }),

  variants: z
    .array(productVariantSchema)
    .min(1, "At least one size variant is required for each color")
    .max(50, "Maximum 50 variants allowed per color")
    .refine(
      (variants) =>
        new Set(variants.map((v) => v.sizeId)).size === variants.length,
      { message: "Duplicate sizes are not allowed for the same color" }
    ),
});



export const createProductSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Product name must be at least 2 characters")
    .max(200, "Product name is too long"),

  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(200, "Slug is too long")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must contain only lowercase letters, numbers and hyphens"
    ),

  description: z
    .string()
    .trim()
    .max(2000, "Description is too long")
    .optional()
    .or(z.literal("")),

  details: z
    .string()
    .trim()
    .max(5000, "Product details are too long")
    .optional()
    .or(z.literal("")),

  categoryId: z
    .number()
    .int("Category ID must be a whole number")
    .positive("Invalid category"),

  isActive: z.boolean().optional(),

  colors: z
    .array(createProductColorSchema)
    .min(1, "At least one color is required")
    .max(20, "Maximum 20 colors allowed per product")
    .refine(
      (colors) =>
        new Set(colors.map((c) => c.colorId)).size === colors.length,
      { message: "Duplicate colors are not allowed" }
    ),
});



export const updateProductSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Product name must be at least 2 characters")
    .max(200, "Product name is too long")
    .optional(),

  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(200, "Slug is too long")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must contain only lowercase letters, numbers and hyphens"
    )
    .optional(),

  description: z
    .string()
    .trim()
    .max(2000, "Description is too long")
    .optional()
    .or(z.literal("")),

  details: z
    .string()
    .trim()
    .max(5000, "Product details are too long")
    .optional()
    .or(z.literal("")),

  categoryId: z
    .number()
    .int("Category ID must be a whole number")
    .positive("Invalid category")
    .optional(),

  isActive: z.boolean().optional(),

  colors: z
    .array(updateProductColorSchema)
    .min(1, "At least one color is required when updating colors")
    .max(20, "Maximum 20 colors allowed per product")
    .refine(
      (colors) =>
        new Set(colors.map((c) => c.colorId)).size === colors.length,
      { message: "Duplicate colors are not allowed" }
    )
    .optional(),


  removedColorIds: z
    .array(
      z
        .number()
        .int("Color ID must be a whole number")
        .positive("Invalid color")
    )
    .max(20, "Cannot remove more than 20 colors at once")
    .refine(
      (ids) => new Set(ids).size === ids.length,
      { message: "Duplicate color IDs in removedColorIds" }
    )
    .optional(),
});



export const productIdSchema = z.object({
  id: z.coerce
    .number()
    .int("Product ID must be a whole number")
    .positive("Invalid product ID"),
});



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
});


export type ProductIdParam = z.infer<typeof productIdSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CreateProductMetadata = z.infer<typeof createProductSchema>;
export type UpdateProductMetadata = z.infer<typeof updateProductSchema>;
export type CreateProductImage = z.infer<typeof createProductImageSchema>;
export type UpdateProductImage = z.infer<typeof updateProductImageSchema>;