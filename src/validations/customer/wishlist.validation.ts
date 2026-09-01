import { z } from "zod";

export const addWishlistItemSchema = z.object({
  productId: z.number().int().positive(),
});

export const removeWishlistItemSchema = z.object({
  productId: z.coerce.number().int().positive(),
});


export type AddWishlistItemInput = z.infer<
  typeof addWishlistItemSchema
>;

export type RemoveWishlistItemInput = z.infer<
  typeof removeWishlistItemSchema
>;
