import resend from "../config/resend";
import AppError from "../errors/AppError";
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
    console.error("Resend request failed:", {
      template: templateId,
      error,
    });

    throw new AppError(DELIVERY_FAILED, 502);
  }

  if (result.error) {
    console.error("Resend rejected the email:", {
      template: templateId,
      name: result.error.name,
      statusCode: result.error.statusCode,
      message: result.error.message,
    });

    throw new AppError(DELIVERY_FAILED, 502);
  }

  return result.data.id;
};

// ------------------------------------------------------------
// MESSAGES
// ------------------------------------------------------------

export const sendOtpEmail = async (
  email: string,
  otp: string,
  expiryMinutes: number
): Promise<string> =>
  sendTemplateEmail(TEMPLATES.otp, email, {
    OTP_CODE: otp,
    EXPIRY_MINUTES: expiryMinutes,
  });
