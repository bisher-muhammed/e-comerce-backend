import resend from "../config/resend";
import AppError from "../errors/AppError";
import { logError } from "../utils/logger.util";
import { requireEnv } from "../utils/require-env.util";

const FROM = requireEnv("RESEND_FROM");

const REPLY_TO = process.env.RESEND_REPLY_TO?.trim();

const TEMPLATES = {
  otp: requireEnv("RESEND_TEMPLATE_OTP"),
} as const;

type TemplateVariables = Record<string, string | number>;

const DELIVERY_FAILED =
  "Unable to send the email. Please try again.";

// ------------------------------------------------------------
// SEND A PUBLISHED TEMPLATE
// ------------------------------------------------------------

const sendTemplateEmail = async (
  templateId: string,
  to: string,
  variables: TemplateVariables
): Promise<string> => {
  const stringified = Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [
      key,
      String(value),
    ])
  );

  const scrub = (text: string) =>
    Object.values(stringified).reduce(
      (redacted, value) =>
        value.length >= 4
          ? redacted.split(value).join("[redacted]")
          : redacted,
      text
    );

  let result;

  try {
    result = await resend.emails.send({
      from: FROM,
      to,
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),

      // No subject and no html: both come from the published template.
      template: {
        id: templateId,
        variables: stringified,
      },
    });
  } catch (error) {
    logError(
      "email.send_failed",
      error,
      { template: templateId },
      scrub
    );

    throw new AppError(DELIVERY_FAILED, 502);
  }

  if (result.error) {
    logError(
      "email.send_rejected",
      result.error,
      {
        template: templateId,
        statusCode: result.error.statusCode,
      },
      scrub
    );

    throw new AppError(DELIVERY_FAILED, 502);
  }

  return result.data.id;
};

// ------------------------------------------------------------
// MESSAGES
// ------------------------------------------------------------

/**
 * Password-reset link. The template is optional configuration
 * (RESEND_TEMPLATE_PASSWORD_RESET, variables RESET_URL and
 * EXPIRY_MINUTES); without it the request is logged and dropped.
 */
export const sendPasswordResetEmail = async (
  email: string,
  resetUrl: string,
  expiryMinutes: number
): Promise<string | null> => {
  const template = process.env.RESEND_TEMPLATE_PASSWORD_RESET?.trim();

  if (!template) {
    logError(
      "email.template_missing",
      new Error("RESEND_TEMPLATE_PASSWORD_RESET is not configured"),
      { alert: true }
    );

    return null;
  }

  return sendTemplateEmail(template, email, {
    RESET_URL: resetUrl,
    EXPIRY_MINUTES: expiryMinutes,
  });
};

export const sendOtpEmail = async (
  email: string,
  otp: string,
  expiryMinutes: number
): Promise<string> =>
  sendTemplateEmail(TEMPLATES.otp, email, {
    OTP_CODE: otp,
    EXPIRY_MINUTES: expiryMinutes,
  });
