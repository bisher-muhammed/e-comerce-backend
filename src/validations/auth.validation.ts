import { email, z } from "zod";
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
    .email("Please provide a valid email address"),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /[A-Z]/,
      "Password must contain at least one uppercase letter"
    )
    .regex(
      /[a-z]/,
      "Password must contain at least one lowercase letter"
    )
    .regex(
      /[0-9]/,
      "Password must contain at least one number"
    )
    .regex(
      /[^A-Za-z0-9]/,
      "Password must contain at least one special character"
    ),
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
  .email("please provide a valid email"),

  password:z
  .string()
  .min(1, "Password is required"),


})


export type RegisterInput = z.infer<typeof registerSchema>;

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export type LoginInput = z.infer<typeof loginSchema>;

