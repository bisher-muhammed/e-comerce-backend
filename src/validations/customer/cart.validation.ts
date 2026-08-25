import { z } from "zod";

export const addToCartSchema = z.object({
  productVariantId: z
    .number({
      error: "Product variant ID is required",
    })
    .int("Product variant ID must be an integer")
    .positive("Product variant ID must be greater than 0"),

  quantity: z
    .number({
      error: "Quantity is required",
    })
    .int("Quantity must be an integer")
    .positive("Quantity must be at least 1")
    .max(100, "Quantity cannot exceed 100"),
});

export const updateCartItemSchema = z.object({
  quantity: z
    .number({
      error: "Quantity is required",
    })
    .int("Quantity must be an integer")
    .positive("Quantity must be at least 1")
    .max(100, "Quantity cannot exceed 100"),
});

export const cartItemParamsSchema = z.object({
  cartItemId: z
    .string()
    .regex(/^\d+$/, "Invalid cart item id")
    .transform(Number),
});
