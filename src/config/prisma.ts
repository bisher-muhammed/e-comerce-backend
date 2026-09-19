import "dotenv/config";
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const parsePositiveInt = (
  raw: string | undefined,
  fallback: number
): number => {
  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
};

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,

  max: parsePositiveInt(
    process.env.DATABASE_POOL_MAX,
    20
  ),

  idleTimeoutMillis: parsePositiveInt(
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS,
    30_000
  ),

  connectionTimeoutMillis: parsePositiveInt(
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
    10_000
  ),

  statement_timeout: parsePositiveInt(
    process.env.DATABASE_STATEMENT_TIMEOUT_MS,
    15_000
  ),

  idle_in_transaction_session_timeout: parsePositiveInt(
    process.env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    20_000
  ),
});

const prisma = new PrismaClient({
  adapter,
});



export default prisma;
