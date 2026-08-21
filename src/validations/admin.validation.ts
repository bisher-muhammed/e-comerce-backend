import { z } from "zod";

export const createAdminSchema = z.object({
  firstName: z
    .string()
    .min(3, "First name must be at least 2 characters")
    .max(50, "First name must not exceed 50 characters")
    .trim(),

  lastName: z
    .string()
    .max(50, "Last name must not exceed 50 characters")
    .trim()
    .optional(),

  email: z
    .string()
    .email("Invalid email address")
    .trim()
    .toLowerCase(),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must not exceed 100 characters"),
});

export type CreateAdminInput = z.infer<
  typeof createAdminSchema
>;

