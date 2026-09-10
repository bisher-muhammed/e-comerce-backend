
import { z } from "zod";


export const couponCodeSchema = z
  .string()
  .trim()
  .min(3, "Coupon code must be at least 3 characters")
  .max(50, "Coupon code must not exceed 50 characters")
  .transform((value) =>
    value.replace(/\s+/g, "").toUpperCase()
  )
  .pipe(
    z
      .string()
      .regex(
        /^[A-Z0-9_-]+$/,
        "Coupon code can contain only letters, numbers, hyphens, and underscores"
      )
  );


export const couponCodeParamsSchema = z.object({
  code: couponCodeSchema,
});



export const validateCouponSchema = z.object({
  code: couponCodeSchema,

  subtotal: z
    .coerce
    .number()
    .finite("Subtotal must be a valid number")
    .min(0, "Subtotal cannot be negative"),
});


export const claimCouponSchema = z.object({});


export type CouponCodeParams = z.infer<
  typeof couponCodeParamsSchema
>;

export type ValidateCouponInput = z.infer<
  typeof validateCouponSchema
>;

export type ClaimCouponInput = z.infer<
  typeof claimCouponSchema
>;
