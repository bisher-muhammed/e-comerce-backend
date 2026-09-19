import { Prisma } from "../../generated/prisma/client";
import AppError from "../errors/AppError";


/**
 * P2034: "Transaction failed due to a write conflict or a deadlock.
 * Please retry your transaction" — this is Prisma surfacing Postgres
 * serialization_failure / deadlock_detected under Serializable
 * isolation. It is EXPECTED to happen under concurrent load and MUST
 * be retried by the application. If you don't retry this, users get a
 * raw 500 on checkout for no reason other than bad luck in timing.
 */
/*
 * P2028 (could not start a transaction in time) is deliberately NOT
 * retried: it means the pool is saturated, and retrying only adds load
 * (M14). It surfaces as a 503 with Retry-After instead.
 */
const RETRYABLE_CODES = new Set([
  "P2034",
  "P1017",
]);

const RETRYABLE_POSTGRES_CODES = new Set([
  "40001",
  "40P01",
]);

export function isSerializationFailure(
  error: Prisma.PrismaClientKnownRequestError
): boolean {
  const meta = (error.meta ?? {}) as Record<string, unknown>;

  const cause = (
    meta.driverAdapterError as
      | {
          cause?: {
            kind?: unknown;
            originalCode?: unknown;
          };
        }
      | undefined
  )?.cause;

  if (cause?.kind === "TransactionWriteConflict") {
    return true;
  }

  return [cause?.originalCode, meta.code].some(
    (code) =>
      typeof code === "string" &&
      RETRYABLE_POSTGRES_CODES.has(code)
  );
}

/**
 * A write conflict can reach us either wrapped (P2034) or, from inside an
 * interactive transaction, as the adapter's raw DriverAdapterError whose
 * cause.kind is "TransactionWriteConflict" — both must be retried.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return (
      RETRYABLE_CODES.has(error.code) || isSerializationFailure(error)
    );
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const cause = (error as { cause?: { kind?: unknown; originalCode?: unknown } })
    .cause;

  return (
    (error as { name?: unknown }).name === "DriverAdapterError" &&
    (cause?.kind === "TransactionWriteConflict" ||
      (typeof cause?.originalCode === "string" &&
        RETRYABLE_POSTGRES_CODES.has(cause.originalCode)))
  );
}

export const CONTENTION_MESSAGE =
  "Lots of people are doing this at the same moment. Please try again.";

export async function withTransactionRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 40 } = options;

  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;

      if (!isRetryableTransactionError(error)) {
        throw error;
      }

      // Out of retries under contention: a clean "try again", not a 500.
      if (attempt > maxRetries) {
        throw new AppError(CONTENTION_MESSAGE, 409, "RETRY_LATER");
      }

      const jitter = Math.random() * baseDelayMs;
      const delay = baseDelayMs * attempt + jitter;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function unquoteIdentifier(value: unknown): string {
  return String(value)
    .trim()
    .replace(/^"(.*)"$/s, "$1");
}

export function violatedColumns(
  error: Prisma.PrismaClientKnownRequestError
): string[] {
  const meta = (error.meta ?? {}) as Record<string, unknown>;

  if (Array.isArray(meta.target)) {
    return meta.target.map(unquoteIdentifier);
  }

  if (typeof meta.target === "string") {
    return meta.target
      .split(",")
      .map(unquoteIdentifier);
  }

  const driverError = meta.driverAdapterError as
    | {
        cause?: {
          constraint?: { fields?: unknown };
          originalMessage?: unknown;
        };
      }
    | undefined;

  const fields = driverError?.cause?.constraint?.fields;

  if (Array.isArray(fields)) {
    return fields.map(unquoteIdentifier);
  }

  const originalMessage =
    driverError?.cause?.originalMessage;

  if (typeof originalMessage === "string") {
    const constraintName = originalMessage.match(
      /unique constraint "([^"]+)"/
    )?.[1];

    if (constraintName) {
      return constraintName.split("_");
    }
  }

  return [];
}

/**
 * True if a Prisma unique-constraint violation (P2002) was caused by
 * the given column.
 */
export function isUniqueConstraintOn(
  error: unknown,
  column: string
): error is Prisma.PrismaClientKnownRequestError {
  const prismaError =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error
      : undefined;

  return (
    prismaError != null &&
    prismaError.code === "P2002" &&
    violatedColumns(prismaError).includes(column)
  );
}
