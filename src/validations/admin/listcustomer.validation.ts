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
