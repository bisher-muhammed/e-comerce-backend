import crypto from "node:crypto";
import redis from "../../config/redis";
import AppError from "../../errors/AppError";
import { REFRESH_TOKEN_TTL_SECONDS, type AuthScope } from "../../utils/jwt";

const REUSE_GRACE_SECONDS = 15;

/*
 * Absolute session lifetime (audit M7): rotation slides the 7-day idle
 * window, but no session outlives this, however often it is used.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export const SESSION_MAX_AGE_MS: Record<AuthScope, number> = {
  storefront:
    Number(process.env.SESSION_MAX_AGE_CUSTOMER_DAYS ?? 30) * DAY_MS,
  admin:
    Number(process.env.SESSION_MAX_AGE_ADMIN_HOURS ?? 12) * 60 * 60 * 1000,
};

interface RefreshSession {
  userId: number;
  jti: string;
  previousJti?: string;
  rotatedAt?: number;
  createdAt?: number;
}

const sessionKey = (sid: string) =>
  `refresh:session:${sid}`;

const userSessionsKey = (userId: number) =>
  `refresh:user:${userId}`;

const newId = () => crypto.randomUUID();

const persist = async (
  sid: string,
  session: RefreshSession
) => {
  await redis
    .multi()
    .set(sessionKey(sid), JSON.stringify(session), {
      EX: REFRESH_TOKEN_TTL_SECONDS,
    })
    .sAdd(userSessionsKey(session.userId), sid)
    .expire(
      userSessionsKey(session.userId),
      REFRESH_TOKEN_TTL_SECONDS
    )
    .exec();
};

// ------------------------------------------------------------
// OPEN A SESSION
// ------------------------------------------------------------

export const startRefreshSession = async (
  userId: number
) => {
  const sid = newId();
  const jti = newId();

  await persist(sid, { userId, jti, createdAt: Date.now() });

  return { sid, jti };
};

// ------------------------------------------------------------
// SPEND ONE TOKEN, MINT THE NEXT
// ------------------------------------------------------------

/*
 * Rotation is a single compare-and-set in Redis (audit M6). Two tabs that
 * refresh with the same token at the same moment are serialised by the
 * script: the first rotates, the second finds its token as `previousJti`
 * inside the grace window and receives the SAME next jti, so both tabs end
 * up holding a valid token and nothing looks like reuse.
 */
const ROTATE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'MISSING'} end
local session = cjson.decode(raw)
if tonumber(session.userId) ~= tonumber(ARGV[1]) then
  return {'USER_MISMATCH', tostring(session.userId)}
end
local now = tonumber(ARGV[4])
local maxAge = tonumber(ARGV[8])
if not session.createdAt then
  -- sessions opened before lifetimes existed start counting now
  session.createdAt = now
end
local age = now - tonumber(session.createdAt)
if age > maxAge then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[7])
  return {'EXPIRED'}
end
local ttl = math.min(tonumber(ARGV[6]), maxAge - age)
if session.jti == ARGV[2] then
  session.previousJti = ARGV[2]
  session.jti = ARGV[3]
  session.rotatedAt = now
  redis.call('SET', KEYS[1], cjson.encode(session), 'PX', ttl)
  -- keep the per-user index alive as long as its sessions, so
  -- revokeAllRefreshSessions always finds them
  redis.call('SADD', KEYS[2], ARGV[7])
  redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[6]))
  return {'ROTATED', ARGV[3]}
end
if session.previousJti == ARGV[2] and session.rotatedAt
   and now - tonumber(session.rotatedAt) <= tonumber(ARGV[5]) then
  return {'GRACE', session.jti}
end
return {'REUSED'}
`;

export const rotateRefreshSession = async (
  sid: string,
  jti: string,
  userId: number,
  scope: AuthScope = "storefront"
) => {
  const [outcome, value] = (await redis.eval(ROTATE_SCRIPT, {
    keys: [sessionKey(sid), userSessionsKey(userId)],
    arguments: [
      String(userId),
      jti,
      newId(),
      String(Date.now()),
      String(REUSE_GRACE_SECONDS * 1000),
      String(REFRESH_TOKEN_TTL_SECONDS * 1000),
      sid,
      String(SESSION_MAX_AGE_MS[scope]),
    ],
  })) as [string, string | undefined];

  if (outcome === "ROTATED" || outcome === "GRACE") {
    return value as string;
  }

  if (outcome === "MISSING") {
    throw new AppError(
      "Refresh token is no longer valid",
      401
    );
  }

  if (outcome === "EXPIRED") {
    throw new AppError(
      "Your session has expired. Please sign in again.",
      401
    );
  }

  if (outcome === "USER_MISMATCH") {
    await revokeRefreshSession(sid, Number(value));

    throw new AppError("Invalid refresh token", 401);
  }

  // A token older than the grace window came back: treat the whole
  // session as compromised.
  await revokeRefreshSession(sid, userId);

  throw new AppError(
    "Refresh token has already been used",
    401
  );
};

// ------------------------------------------------------------
// CLOSE A SESSION
// ------------------------------------------------------------

export const revokeRefreshSession = async (
  sid: string,
  userId: number
) => {
  await redis
    .multi()
    .del(sessionKey(sid))
    .sRem(userSessionsKey(userId), sid)
    .exec();
};

export const revokeAllRefreshSessions = async (
  userId: number
) => {
  const sids = await redis.sMembers(
    userSessionsKey(userId)
  );

  await redis.del([
    ...sids.map(sessionKey),
    userSessionsKey(userId),
  ]);
};
