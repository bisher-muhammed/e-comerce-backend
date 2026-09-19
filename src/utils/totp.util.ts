/*
 * RFC 6238 TOTP (SHA-1, 30 s, 6 digits — what every authenticator app
 * speaks) and at-rest encryption of the shared secret (AES-256-GCM).
 */
import crypto from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const base32Encode = (buffer: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32[(value << (5 - bits)) & 31];
  }

  return output;
};

export const base32Decode = (input: string): Buffer => {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32.indexOf(char);

    if (index === -1) {
      throw new Error("Invalid base32 secret");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
};

export const generateTotpSecret = () =>
  base32Encode(crypto.randomBytes(20));

export const currentStep = (now = Date.now()) =>
  Math.floor(now / 1000 / STEP_SECONDS);

export const totpAt = (secret: string, step: number): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const hmac = crypto
    .createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();

  const offset = hmac[hmac.length - 1] & 0xf;

  const code =
    (((hmac[offset] & 0x7f) << 24) |
      (hmac[offset + 1] << 16) |
      (hmac[offset + 2] << 8) |
      hmac[offset + 3]) %
    10 ** DIGITS;

  return code.toString().padStart(DIGITS, "0");
};

/**
 * The time step the code belongs to (±1 step for clock drift), or null.
 * Comparison is constant-time.
 */
export const matchTotpStep = (
  secret: string,
  code: string,
  now = Date.now()
): number | null => {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }

  const step = currentStep(now);

  for (const candidate of [step - 1, step, step + 1]) {
    const expected = Buffer.from(totpAt(secret, candidate));

    if (crypto.timingSafeEqual(expected, Buffer.from(code))) {
      return candidate;
    }
  }

  return null;
};

export const otpauthUrl = (
  secret: string,
  accountName: string,
  issuer: string
) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    accountName
  )}?secret=${secret}&issuer=${encodeURIComponent(
    issuer
  )}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// ------------------------------------------------------------
// At-rest encryption
// ------------------------------------------------------------

const encryptionKey = (): Buffer | null => {
  const hex = process.env.MFA_ENCRYPTION_KEY?.trim();

  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    return null;
  }

  return Buffer.from(hex, "hex");
};

export const isMfaConfigured = () => encryptionKey() !== null;

export const encryptSecret = (secret: string): string => {
  const key = encryptionKey();

  if (!key) {
    throw new Error("MFA_ENCRYPTION_KEY is not configured");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
};

export const decryptSecret = (stored: string): string => {
  const key = encryptionKey();

  if (!key) {
    throw new Error("MFA_ENCRYPTION_KEY is not configured");
  }

  const [version, iv, tag, ciphertext] = stored.split(".");

  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Unrecognised MFA secret format");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
};
