import { z } from "zod";

export const offerTypeSchema = z.enum(["PRODUCT", "CATEGORY"]);

const discountPercentageSchema = z.coerce
  .number()
  .positive("Discount percentage must be greater than 0")
  .max(100, "Discount percentage cannot exceed 100%")
  .finite("Discount percentage must be a valid number");

export const offerIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createOfferSchema = z
  .object({
    type: offerTypeSchema,

    productId: z.coerce.number().int().positive().optional(),

    categoryId: z.coerce.number().int().positive().optional(),

    discountPercentage: discountPercentageSchema,

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

    if (data.type === "PRODUCT") {
      if (data.productId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "productId is required for a PRODUCT offer",
          path: ["productId"],
        });
      }
      if (data.categoryId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "categoryId must not be set for a PRODUCT offer",
          path: ["categoryId"],
        });
      }
    }

    if (data.type === "CATEGORY") {
      if (data.categoryId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "categoryId is required for a CATEGORY offer",
          path: ["categoryId"],
        });
      }
      if (data.productId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "productId must not be set for a CATEGORY offer",
          path: ["productId"],
        });
      }
    }
  });

export const updateOfferSchema = z
  .object({
    type: offerTypeSchema.optional(),

    productId: z.coerce.number().int().positive().optional(),

    categoryId: z.coerce.number().int().positive().optional(),

    discountPercentage: discountPercentageSchema.optional(),

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

    if (data.productId !== undefined && data.categoryId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only one of productId or categoryId can be set",
        path: ["productId"],
      });
    }

    if (data.type === "PRODUCT" && data.categoryId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "categoryId must not be set for a PRODUCT offer",
        path: ["categoryId"],
      });
    }

    if (data.type === "CATEGORY" && data.productId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "productId must not be set for a CATEGORY offer",
        path: ["productId"],
      });
    }
  });

export const updateOfferStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listOffersSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),

    limit: z.coerce.number().int().min(1).max(50).default(10),

    search: z.string().trim().min(1).max(100).optional(),

    type: offerTypeSchema.optional(),

    productId: z.coerce.number().int().positive().optional(),

    categoryId: z.coerce.number().int().positive().optional(),

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
        "discountPercentage",
        "startsOn",
        "expiresOn",
      ])
      .default("createdAt"),

    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine(
    (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
    {
      message: "startDate must be before or equal to endDate",
      path: ["startDate"],
    }
  );

export type OfferType = z.infer<typeof offerTypeSchema>;
export type OfferIdParam = z.infer<typeof offerIdSchema>;
export type UpdateOfferStatusInput = z.infer<typeof updateOfferStatusSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;
export type ListOffersInput = z.infer<typeof listOffersSchema>;