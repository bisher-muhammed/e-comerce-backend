import { z } from "zod";

export const couponDiscountTypeSchema = z.enum([
  "PERCENTAGE",
  "FIXED",
]);


const couponNameSchema = z
  .string()
  .trim()
  .min(2, "Coupon name must be at least 2 characters")
  .max(100, "Coupon name must not exceed 100 characters");

const couponCodeSchema = z
  .string()
  .trim()
  .min(3, "Coupon code must be at least 3 characters")
  .max(50, "Coupon code must not exceed 50 characters")
  .transform((value) => value.replace(/\s+/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .regex(
        /^[A-Z0-9_-]+$/,
        "Coupon code can contain only letters, numbers, hyphens, and underscores"
      )
  );

const discountValueSchema = z.coerce
  .number()
  .positive("Discount value must be greater than 0")
  .finite("Discount value must be a valid number");

const minimumOrderAmountSchema = z.coerce
  .number()
  .min(0, "Minimum order amount cannot be negative")
  .finite("Minimum order amount must be a valid number");

const maximumDiscountAmountSchema = z.union([
  z.coerce
    .number()
    .positive("Maximum discount amount must be greater than 0")
    .finite("Maximum discount amount must be a valid number"),
  z.null(),
]);
export const couponIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export const createCouponSchema = z
  .object({
    name: couponNameSchema,

    code: couponCodeSchema,

    discountType: couponDiscountTypeSchema,

    discountValue: discountValueSchema,

    minimumOrderAmount: minimumOrderAmountSchema.default(0),

    maximumDiscountAmount: maximumDiscountAmountSchema.optional(),

    startsOn: z.coerce.date({
      message: "A valid start date is required",
    }),

    expiresOn: z.coerce.date({
      message: "A valid expiry date is required",
    }),

    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.startsOn > data.expiresOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must be before or equal to expiry date",
        path: ["startsOn"],
      });
    }
    if (data.discountType === "PERCENTAGE") {
      if (data.discountValue > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Percentage discount cannot exceed 100%",
          path: ["discountValue"],
        });
      }

      if (
        data.maximumDiscountAmount !== undefined &&
        data.maximumDiscountAmount !== null &&
        data.maximumDiscountAmount <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Maximum discount amount must be greater than 0",
          path: ["maximumDiscountAmount"],
        });
      }
    }
    if (
      data.discountType === "FIXED" &&
      data.maximumDiscountAmount !== undefined &&
      data.maximumDiscountAmount !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Maximum discount amount can only be used with percentage coupons",
        path: ["maximumDiscountAmount"],
      });
    }
  });

export const updateCouponSchema = z
  .object({
    name: couponNameSchema.optional(),

    code: couponCodeSchema.optional(),

    discountType: couponDiscountTypeSchema.optional(),

    discountValue: discountValueSchema.optional(),

    minimumOrderAmount: minimumOrderAmountSchema.optional(),

    maximumDiscountAmount:
      maximumDiscountAmountSchema.optional(),

    startsOn: z.coerce.date().optional(),

    expiresOn: z.coerce.date().optional(),

    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {


    if (
      data.startsOn !== undefined &&
      data.expiresOn !== undefined &&
      data.startsOn > data.expiresOn
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must be before or equal to expiry date",
        path: ["startsOn"],
      });
    }


    if (
      data.discountType === "PERCENTAGE" &&
      data.discountValue !== undefined &&
      data.discountValue > 100
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage discount cannot exceed 100%",
        path: ["discountValue"],
      });
    }
    if (
      data.discountType === "FIXED" &&
      data.maximumDiscountAmount !== undefined &&
      data.maximumDiscountAmount !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Maximum discount amount can only be used with percentage coupons",
        path: ["maximumDiscountAmount"],
      });
    }
  });


export const updateCouponStatusSchema = z.object({
  isActive: z.boolean(),
});


export const listCouponsSchema = z
  .object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .default(1),

    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10),

    search: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    discountType: couponDiscountTypeSchema.optional(),

    isActive: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),

    startDate: z.coerce.date().optional(),

    endDate: z.coerce.date().optional(),

    orderBy: z
      .enum([
        "createdAt",
        "updatedAt",
        "name",
        "code",
        "startsOn",
        "expiresOn",
        "discountValue",
        "minimumOrderAmount",
      ])
      .default("createdAt"),

    order: z
      .enum(["asc", "desc"])
      .default("desc"),
  })
  .refine(
    (data) =>
      !data.startDate ||
      !data.endDate ||
      data.startDate <= data.endDate,
    {
      message:
        "startDate must be before or equal to endDate",
      path: ["startDate"],
    }
  );


export type CouponDiscountType = z.infer<
  typeof couponDiscountTypeSchema
>;

export type CreateCouponInput = z.infer<
  typeof createCouponSchema
>;

export type UpdateCouponInput = z.infer<
  typeof updateCouponSchema
>;

export type ListCouponsInput = z.infer<
  typeof listCouponsSchema
>;

