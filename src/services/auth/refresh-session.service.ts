import crypto from "node:crypto";
import redis from "../../config/redis";
import AppError from "../../errors/AppError";
import { REFRESH_TOKEN_TTL_SECONDS } from "../../utils/jwt";

const REUSE_GRACE_SECONDS = 15;

interface RefreshSession {
  userId: number;
  jti: string;
  previousJti?: string;
  rotatedAt?: number;
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

const readSession = async (sid: string) => {
  const stored = await redis.get(sessionKey(sid));

  if (!stored) {
    return null;
  }

  return JSON.parse(stored) as RefreshSession;
};

// ------------------------------------------------------------
// OPEN A SESSION
// ------------------------------------------------------------

export const startRefreshSession = async (
  userId: number
) => {
  const sid = newId();
  const jti = newId();

  await persist(sid, { userId, jti });

  return { sid, jti };
};

// ------------------------------------------------------------
// SPEND ONE TOKEN, MINT THE NEXT
// ------------------------------------------------------------

export const rotateRefreshSession = async (
  sid: string,
  jti: string,
  userId: number
) => {
  const session = await readSession(sid);

  if (!session) {
    throw new AppError(
      "Refresh token is no longer valid",
      401
    );
  }

  if (session.userId !== userId) {
    await revokeRefreshSession(sid, session.userId);

    throw new AppError("Invalid refresh token", 401);
  }

  if (session.jti === jti) {
    const nextJti = newId();

    await persist(sid, {
      userId,
      jti: nextJti,
      previousJti: jti,
      rotatedAt: Date.now(),
    });

    return nextJti;
  }

  const withinGrace =
    session.previousJti === jti &&
    session.rotatedAt !== undefined &&
    Date.now() - session.rotatedAt <=
      REUSE_GRACE_SECONDS * 1000;

  if (withinGrace) {
    return session.jti;
  }

  await revokeRefreshSession(sid, session.userId);

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
