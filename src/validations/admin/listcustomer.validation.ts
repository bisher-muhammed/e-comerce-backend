import { z } from "zod";

export const listCustomersSchema = z.object({
  search: z.string().trim().optional(),

  status: z
    .enum([
      "PENDING_VERIFICATION",
      "ACTIVE",
      "SUSPENDED",
      "DEACTIVATED",
    ])
    .optional(),

  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
});

export const customerIdSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive("Invalid customer ID"),
});

export const updateCustomerStatusSchema = z.object({
  status: z.enum([
    "ACTIVE",
    "SUSPENDED",
    "DEACTIVATED",
  ]),
});

export type ListCustomersInput = z.infer<
  typeof listCustomersSchema
>;

export type CustomerIdParam = z.infer<
  typeof customerIdSchema
>;

export type UpdateCustomerStatusInput = z.infer<
  typeof updateCustomerStatusSchema
>;
