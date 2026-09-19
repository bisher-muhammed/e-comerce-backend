/*
 * Start-up configuration check (audit M8).
 *
 * The process refuses to boot with a configuration that would run
 * insecurely or fail later at request time: missing or weak JWT secrets,
 * identical access/refresh secrets, a missing Razorpay webhook secret in
 * production, and so on. Every problem is reported at once.
 *
 * Security no longer depends on NODE_ENV being set: cookies are Secure and
 * error bodies generic by default. The only way to weaken either is an
 * explicit development flag, which production refuses.
 */
import { z } from "zod";

const secret = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .refine((value) => Buffer.byteLength(value, "utf8") >= 32, {
      message: `${name} must be at least 32 bytes (generate with: openssl rand -hex 64)`,
    })
    .refine((value) => !/^replace-?me/i.test(value), {
      message: `${name} still has its placeholder value`,
    });

const required = (name: string) =>
  z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

const flag = z.enum(["true", "false"]).optional();

const baseSchema = z.object({
  NODE_ENV: z.string().optional(),

  DATABASE_URL: required("DATABASE_URL").refine(
    (value) => /^postgres(ql)?:\/\//.test(value),
    { message: "DATABASE_URL must be a postgresql:// URL" }
  ),

  REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: secret("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: secret("JWT_REFRESH_SECRET"),

  RAZORPAY_KEY_ID: required("RAZORPAY_KEY_ID"),
  RAZORPAY_KEY_SECRET: required("RAZORPAY_KEY_SECRET"),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  RESEND_API_KEY: required("RESEND_API_KEY"),
  RESEND_FROM: required("RESEND_FROM"),
  RESEND_TEMPLATE_OTP: required("RESEND_TEMPLATE_OTP"),

  CLOUDINARY_CLOUD_NAME: required("CLOUDINARY_CLOUD_NAME"),
  CLOUDINARY_API_KEY: required("CLOUDINARY_API_KEY"),
  CLOUDINARY_API_SECRET: required("CLOUDINARY_API_SECRET"),

  CORS_ORIGINS: z.string().optional(),
  COOKIE_DOMAIN: z.string().optional(),

  COOKIE_INSECURE_DEV: flag,
  EXPOSE_ERROR_DETAILS: flag,

  ADMIN_MFA_REQUIRED: flag,
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "MFA_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)")
    .optional()
    .or(z.literal("")),
});

export type AppEnv = z.infer<typeof baseSchema>;

export const isProduction = (env: NodeJS.ProcessEnv = process.env) =>
  env.NODE_ENV === "production";

/** Every problem with the given environment, empty when it is usable. */
export const validateEnv = (env: NodeJS.ProcessEnv): string[] => {
  const problems: string[] = [];
  const parsed = baseSchema.safeParse(env);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(issue.message);
    }
  }

  if (
    env.JWT_ACCESS_SECRET &&
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
  ) {
    problems.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ");
  }

  if (env.ADMIN_MFA_REQUIRED === "true" && !env.MFA_ENCRYPTION_KEY) {
    problems.push("ADMIN_MFA_REQUIRED=true needs MFA_ENCRYPTION_KEY");
  }

  if (isProduction(env)) {
    if (!env.RAZORPAY_WEBHOOK_SECRET?.trim()) {
      problems.push(
        "RAZORPAY_WEBHOOK_SECRET is required in production (payment confirmation and late-capture refunds depend on the webhook)"
      );
    }

    if (!env.COOKIE_DOMAIN?.trim()) {
      problems.push(
        "COOKIE_DOMAIN is required in production (e.g. .raviscort.com)"
      );
    }

    if (!env.CORS_ORIGINS?.trim()) {
      problems.push("CORS_ORIGINS is required in production");
    }

    if (env.COOKIE_INSECURE_DEV === "true") {
      problems.push("COOKIE_INSECURE_DEV must not be set in production");
    }

    if (env.EXPOSE_ERROR_DETAILS === "true") {
      problems.push("EXPOSE_ERROR_DETAILS must not be set in production");
    }

    if (/^rzp_test_/.test(env.RAZORPAY_KEY_ID ?? "")) {
      problems.push("RAZORPAY_KEY_ID is a test key in production");
    }
  }

  return problems;
};

/** Throws one error listing every configuration problem. */
export const assertValidEnv = (env: NodeJS.ProcessEnv = process.env) => {
  const problems = validateEnv(env);

  if (problems.length > 0) {
    throw new Error(
      `Invalid configuration:\n  - ${problems.join("\n  - ")}`
    );
  }
};
