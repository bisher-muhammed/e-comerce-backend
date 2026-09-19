import { z } from "zod";
import { customerPasswordSchema } from "../utils/password-policy.util";
export const registerSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(3, "First name must be at least 3 characters")
    .regex(
      /^[A-Za-z0-9]+$/,
      "First name can only contain letters and numbers"
    ),

  lastName: z
    .string()
    .trim()
    .min(1, "Last name must be at least 1 character")
    .regex(
      /^[A-Za-z0-9]+$/,
      "Last name can only contain letters and numbers"
    ),

  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address"),

  password: customerPasswordSchema,
});

export const verifyOtpSchema = z.object({
  otp: z
    .string()
    .regex(/^\d{6}$/, "OTP must be a 6-digit number"),
});

export const loginSchema = z.object({
  email:z
  .string()
  .trim()
  .toLowerCase()
  .email("please provide a valid email"),

  password:z
  .string()
  .min(1, "Password is required"),


})


export const mfaCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const disableMfaSchema = mfaCodeSchema.extend({
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  // Role-specific rules are applied in the service.
  newPassword: z.string().min(8).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please provide a valid email"),
});

export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, "Invalid reset link"),
  newPassword: z.string().min(8).max(128),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;
export type DisableMfaInput = z.infer<typeof disableMfaSchema>;

export type RegisterInput = z.infer<typeof registerSchema>;

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export type LoginInput = z.infer<typeof loginSchema>;

