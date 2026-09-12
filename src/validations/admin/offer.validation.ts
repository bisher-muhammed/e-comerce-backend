import { z } from "zod";
import { OfferDiscountType } from "../../../generated/prisma/enums";



const offerIdSchema = z.object({
    offerId: z.coerce.number().int().positive(),
});



const discountTypeSchema = z.enum(OfferDiscountType);

const discountValueSchema = z.coerce
    .number()
    .positive("Discount value must be greater than 0")
    .finite("Discount value must be a valid number");



const productIdsSchema = z
    .array(z.coerce.number().int().positive())
    .max(100, "You can target a maximum of 100 products")
    .default([]);

const categoryIdsSchema = z
    .array(z.coerce.number().int().positive())
    .max(100, "You can target a maximum of 100 categories")
    .default([]);



export const createOfferSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(2, "Offer name must contain at least 2 characters")
            .max(100, "Offer name cannot exceed 100 characters"),

        discountType: discountTypeSchema,

        discountValue: discountValueSchema,

        startsAt: z.coerce.date({
            error: "Start date is required",
        }),

        endsAt: z.coerce.date({
            error: "End date is required",
        }),

        isActive: z.boolean().default(true),

        productIds: productIdsSchema,

        categoryIds: categoryIdsSchema,
    })
    .superRefine((data, ctx) => {


        if (data.endsAt <= data.startsAt) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["endsAt"],
                message: "End date must be after start date",
            });
        }



        if (
            data.productIds.length === 0 &&
            data.categoryIds.length === 0
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["productIds"],
                message:
                    "Offer must target at least one product or category",
            });
        }



        if (
            data.discountType === OfferDiscountType.PERCENTAGE &&
            data.discountValue > 100
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["discountValue"],
                message: "Percentage discount cannot exceed 100%",
            });
        }
    });



export const updateOfferSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(2, "Offer name must contain at least 2 characters")
            .max(100, "Offer name cannot exceed 100 characters")
            .optional(),

        discountType: discountTypeSchema.optional(),

        discountValue: discountValueSchema.optional(),

        startsAt: z.coerce.date().optional(),

        endsAt: z.coerce.date().optional(),

        isActive: z.boolean().optional(),

        productIds: productIdsSchema.optional(),

        categoryIds: categoryIdsSchema.optional(),
    })
    .superRefine((data, ctx) => {


        if (data.startsAt && data.endsAt) {
            if (data.endsAt <= data.startsAt) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["endsAt"],
                    message: "End date must be after start date",
                });
            }
        }



        if (
            data.discountType === OfferDiscountType.PERCENTAGE &&
            data.discountValue !== undefined &&
            data.discountValue > 100
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["discountValue"],
                message: "Percentage discount cannot exceed 100%",
            });
        }



        if (
            data.productIds !== undefined &&
            data.categoryIds !== undefined &&
            data.productIds.length === 0 &&
            data.categoryIds.length === 0
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["productIds"],
                message:
                    "Offer must target at least one product or category",
            });
        }
    });



export const listOffersQuerySchema = z.object({
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

    search: z
        .string()
        .trim()
        .max(100)
        .optional(),

    discountType: discountTypeSchema.optional(),

    isActive: z
        .enum(["true", "false"])
        .transform((value) => value === "true")
        .optional(),

    startsFrom: z.coerce.date().optional(),

    startsTo: z.coerce.date().optional(),

    endsFrom: z.coerce.date().optional(),

    endsTo: z.coerce.date().optional(),

    sortBy: z
        .enum([
            "name",
            "discountValue",
            "startsAt",
            "endsAt",
            "createdAt",
        ])
        .default("createdAt"),

    sortOrder: z
        .enum(["asc", "desc"])
        .default("desc"),
});



export const getOfferSchema = offerIdSchema;

export const updateOfferParamsSchema = offerIdSchema;

export const deleteOfferSchema = offerIdSchema;


export const updateOfferStatusSchema = z.object({
    isActive: z.boolean(),
});


export type CreateOfferInput = z.infer<
    typeof createOfferSchema
>;

export type UpdateOfferInput = z.infer<
    typeof updateOfferSchema
>;

export type ListOffersQuery = z.infer<
    typeof listOffersQuerySchema
>;

export type OfferIdParams = z.infer<
    typeof offerIdSchema
>;

export type UpdateOfferStatusInput = z.infer<
    typeof updateOfferStatusSchema
>;