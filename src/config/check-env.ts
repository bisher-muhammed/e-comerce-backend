/*
 * Imported first by server.ts, so the configuration is checked before any
 * module reads it — regardless of how imports are hoisted.
 */
import "dotenv/config";

import { assertValidEnv } from "./env";

try {
  assertValidEnv();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
