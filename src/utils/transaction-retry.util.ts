import { Prisma } from "../../generated/prisma/client";


/**
 * P2034: "Transaction failed due to a write conflict or a deadlock.
 * Please retry your transaction" — this is Prisma surfacing Postgres
 * serialization_failure / deadlock_detected under Serializable
 * isolation. It is EXPECTED to happen under concurrent load and MUST
 * be retried by the application. If you don't retry this, users get a
 * raw 500 on checkout for no reason other than bad luck in timing.
 */
const RETRYABLE_CODES = new Set(["P2034"]);

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
        prismaError != null && RETRYABLE_CODES.has(prismaError.code);

      if (!isRetryable || attempt > maxRetries) {
        throw error;
      }

      const jitter = Math.random() * baseDelayMs;
      const delay = baseDelayMs * attempt + jitter;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
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
    Array.isArray((prismaError.meta as any)?.target) &&
    (prismaError.meta as any).target.includes(column)
  );
}