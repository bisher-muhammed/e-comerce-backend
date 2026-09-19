import { z } from "zod";
import { adminPasswordSchema } from "../utils/password-policy.util";
import { ALL_PERMISSIONS } from "../utils/permissions.util";

const permissionListSchema = z
  .array(z.enum(ALL_PERMISSIONS as [string, ...string[]]))
  .max(ALL_PERMISSIONS.length);

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

  password: adminPasswordSchema,

  // Omitted = the least-privilege default set.
  permissions: permissionListSchema.optional(),
});

export const adminPermissionsSchema = z.object({
  permissions: permissionListSchema,
});

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(100_000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  actorId: z.coerce.number().int().positive().max(2_147_483_647).optional(),
  entityType: z.string().trim().min(1).max(50).optional(),
  entityId: z.string().trim().min(1).max(50).optional(),
});

export type AdminPermissionsInput = z.infer<typeof adminPermissionsSchema>;
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export const adminIdSchema = z.object({
  id: z.coerce
    .number()
    .int("Admin ID must be a whole number")
    .positive("Invalid admin ID"),
});

export const adminStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

export type AdminStatusInput = z.infer<typeof adminStatusSchema>;

export type CreateAdminInput = z.infer<
  typeof createAdminSchema
>;

export type AdminIdParam = z.infer<
  typeof adminIdSchema
>;

