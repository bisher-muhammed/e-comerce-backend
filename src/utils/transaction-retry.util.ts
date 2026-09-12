import { Prisma } from "../../generated/prisma/client";


/**
 * P2034: "Transaction failed due to a write conflict or a deadlock.
 * Please retry your transaction" — this is Prisma surfacing Postgres
 * serialization_failure / deadlock_detected under Serializable
 * isolation. It is EXPECTED to happen under concurrent load and MUST
 * be retried by the application. If you don't retry this, users get a
 * raw 500 on checkout for no reason other than bad luck in timing.
 */
const RETRYABLE_CODES = new Set([
  "P2034",
  "P2028",
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

      const prismaError =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? (error as Prisma.PrismaClientKnownRequestError & { code: string })
          : undefined;
      const isRetryable =
        prismaError != null &&
        (RETRYABLE_CODES.has(prismaError.code) ||
          isSerializationFailure(prismaError));

      if (!isRetryable || attempt > maxRetries) {
        throw error;
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
