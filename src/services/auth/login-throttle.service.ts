/*
 * Account-level login throttle (audit M4).
 *
 * The per-IP limiters stop one client; this stops a distributed attacker
 * (botnet, proxy pool, IPv6 range) from guessing one account's password,
 * because it is keyed by the account alone.
 *
 * It slows down rather than locks out: the first FREE_ATTEMPTS attempts
 * are free, then each further attempt must wait 1s, 2s, 4s … capped at
 * MAX_DELAY. A victim is never locked out for longer than MAX_DELAY by
 * someone else's guessing, while an attacker's throughput collapses to
 * roughly one guess per MAX_DELAY.
 *
 * The check-and-reserve runs as one Lua script, so a burst of parallel
 * requests cannot all slip through the same release moment: every attempt
 * is reserved as a failure before the password is checked, and a correct
 * password clears the record.
 */
import crypto from "node:crypto";

import redis, { connectRedis } from "../../config/redis";

export const FREE_ATTEMPTS = 5;

export const MAX_DELAY_MS = 15 * 60 * 1000;

const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

const RESERVE_SCRIPT = `
local failures = tonumber(redis.call('HGET', KEYS[1], 'f') or '0')
local nextAllowed = tonumber(redis.call('HGET', KEYS[1], 'n') or '0')
local now = tonumber(ARGV[1])
if now < nextAllowed then
  return {0, nextAllowed - now, failures}
end
failures = failures + 1
local delay = 0
local free = tonumber(ARGV[2])
if failures >= free then
  delay = math.min(1000 * (2 ^ (failures - free)), tonumber(ARGV[3]))
end
redis.call('HSET', KEYS[1], 'f', failures, 'n', now + delay)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]))
return {1, 0, failures}
`;

const recordKey = (email: string) =>
  `login:account:${crypto
    .createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")}`;

export interface ThrottleDecision {
  allowed: boolean;
  retryAfterMs: number;
  /** Attempts recorded in the current streak, this one included. */
  attempts: number;
}

export const reserveLoginAttempt = async (
  email: string,
  now = Date.now()
): Promise<ThrottleDecision> => {
  await connectRedis();

  const [allowed, retryAfterMs, attempts] = (await redis.eval(
    RESERVE_SCRIPT,
    {
      keys: [recordKey(email)],
      arguments: [
        String(now),
        String(FREE_ATTEMPTS),
        String(MAX_DELAY_MS),
        String(RECORD_TTL_MS),
      ],
    }
  )) as [number, number, number];

  return {
    allowed: allowed === 1,
    retryAfterMs: Number(retryAfterMs),
    attempts: Number(attempts),
  };
};

/** A correct password ends the streak. */
export const clearLoginFailures = async (email: string) => {
  await connectRedis();
  await redis.del(recordKey(email));
};
