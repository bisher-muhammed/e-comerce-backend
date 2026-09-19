/*
 * Password policy (audit M4 / M7).
 *
 * Customers keep the existing composition rules. Admin accounts, which can
 * refund money and read every customer's data, need length (≥ 12) and
 * must not be a well-known password. An optional breach check against
 * Have I Been Pwned's k-anonymity API can be switched on with
 * PASSWORD_BREACH_CHECK=true (only the first 5 hex chars of the SHA-1 ever
 * leave the server).
 */
import crypto from "node:crypto";
import { z } from "zod";

import AppError from "../errors/AppError";
import { logError } from "./logger.util";

// Frequently breached passwords that satisfy naive length/composition
// rules. Compared case-insensitively.
const COMMON_PASSWORDS = new Set(
  [
    "password", "password1", "password12", "password123", "password1234",
    "passw0rd", "p@ssw0rd", "p@ssword", "p@ssword1", "p@ssw0rd123",
    "password@123", "password#123", "admin123", "admin@123", "admin1234",
    "administrator", "administrator1", "welcome1", "welcome123", "welcome@123",
    "qwerty123", "qwertyuiop", "qwerty@123", "qwertyuiop1", "1q2w3e4r5t",
    "1qaz2wsx3edc", "zaq12wsx", "123456789", "1234567890", "12345678910",
    "123456789012", "iloveyou1", "letmein123", "changeme123", "changeme",
    "trustno1", "football123", "baseball123", "monkey123", "sunshine1",
    "princess1", "dragon123", "superman123", "master123", "abc123456",
    "abcd1234", "abcdefgh", "india@123", "india123", "mumbai123",
    "raviscort", "raviscort123", "raviscort@123", "summer2026", "winter2026",
    "spring2026", "autumn2026", "summer2025", "winter2025", "company123",
  ].map((p) => p.toLowerCase())
);

export const isCommonPassword = (password: string) =>
  COMMON_PASSWORDS.has(password.toLowerCase());

/** Composition rules customers already had, plus the common-password list. */
export const customerPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must not exceed 128 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character"
  )
  .refine((value) => !isCommonPassword(value), {
    message: "This password is too common. Choose a different one.",
  });

export const adminPasswordSchema = z
  .string()
  .min(12, "Admin passwords must be at least 12 characters")
  .max(128, "Password must not exceed 128 characters")
  .refine((value) => new Set(value).size >= 6, {
    message: "Password is too repetitive",
  })
  .refine((value) => !isCommonPassword(value), {
    message: "This password is too common. Choose a different one.",
  });

/** Rejects passwords that contain the account's own email name. */
export const assertPasswordNotPersonal = (
  password: string,
  email: string
) => {
  const local = email.split("@")[0]?.toLowerCase() ?? "";

  if (local.length >= 4 && password.toLowerCase().includes(local)) {
    throw new AppError(
      "Password must not contain your email address",
      400
    );
  }
};

/**
 * Have I Been Pwned range query. Opt-in; a network failure never blocks
 * the user (the other rules still apply) but is logged.
 */
export const assertPasswordNotBreached = async (password: string) => {
  if (process.env.PASSWORD_BREACH_CHECK !== "true") {
    return;
  }

  const hash = crypto
    .createHash("sha1")
    .update(password)
    .digest("hex")
    .toUpperCase();

  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const res = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: { "Add-Padding": "true" },
        signal: AbortSignal.timeout(2000),
      }
    );

    if (!res.ok) {
      throw new Error(`HIBP responded ${res.status}`);
    }

    const body = await res.text();

    const breached = body
      .split("\n")
      .some((line) => {
        const [candidate, count] = line.trim().split(":");
        return candidate === suffix && Number(count) > 0;
      });

    if (breached) {
      throw new AppError(
        "This password has appeared in a data breach. Choose a different one.",
        400
      );
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logError("password.breach_check_unavailable", error);
  }
};
