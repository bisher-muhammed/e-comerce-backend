import crypto from "crypto";

import {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  ipKeyGenerator,
  rateLimit,
  Options,
  RateLimitRequestHandler,
} from "express-rate-limit";

import { RedisStore } from "rate-limit-redis";

import redis, { connectRedis } from "../config/redis";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

type RedisReply =
  | boolean
  | number
  | string
  | Array<boolean | number | string>;

const createStore = (prefix: string) =>
  new RedisStore({
    prefix: `rl:${prefix}:`,

    sendCommand: async (...args: string[]) => {
      await connectRedis();

      return redis.sendCommand(
        args
      ) as unknown as Promise<RedisReply>;
    },
  });

const ipKey = (req: Request) =>
  ipKeyGenerator(req.ip ?? "");

const bodyKey = (req: Request, field: string) => {
  const value = (
    req.body as Record<string, unknown> | undefined
  )?.[field];

  if (typeof value !== "string" || value.length === 0) {
    return `anon:${ipKey(req)}`;
  }

  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
};

const userKey = (req: Request) =>
  req.user ? `user:${req.user.id}` : ipKey(req);

const tooManyRequests =
  (message: string) =>
  (
    req: Request,
    res: Response,
    next: NextFunction,
    options: Options
  ) => {
    res.status(options.statusCode).json({
      success: false,
      message,
    });
  };

interface LimiterConfig {

  prefix: string;
  windowMs: number;
  limit: number;
  message: string;
  keyGenerator?: Options["keyGenerator"];
  skipSuccessfulRequests?: boolean;
  emitHeaders?: boolean;
}

const createLimiter = ({
  prefix,
  windowMs,
  limit,
  message,
  keyGenerator = ipKey,
  skipSuccessfulRequests = false,
  emitHeaders = true,
}: LimiterConfig): RateLimitRequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: emitHeaders ? "draft-7" : false,
    legacyHeaders: false,
    passOnStoreError: true,
    skipSuccessfulRequests,
    keyGenerator,
    handler: tooManyRequests(message),
    store: createStore(prefix),
  });

const AUTH_MESSAGE =
  "Too many attempts. Please try again later.";

export const globalLimiter = createLimiter({
  prefix: "global",
  windowMs: 15 * MINUTE,
  limit: 600,
  message:
    "Too many requests. Please try again later.",
});

export const loginLimiter = [
  createLimiter({
    prefix: "login:ip",
    windowMs: 15 * MINUTE,
    limit: 25,
    skipSuccessfulRequests: true,
    message: "Too many login attempts. Please try again later.",
  }),
  createLimiter({
    prefix: "login:account",
    windowMs: 15 * MINUTE,
    limit: 5,
    skipSuccessfulRequests: true,
    emitHeaders: false,
    keyGenerator: (req) =>
      `${ipKey(req)}:${bodyKey(req, "email")}`,
    message: "Too many login attempts. Please try again later.",
  }),
];

export const registerLimiter = [
  createLimiter({
    prefix: "register:ip",
    windowMs: HOUR,
    limit: 5,
    message:
      "Too many registration attempts. Please try again later.",
  }),
  createLimiter({
    prefix: "register:email",
    windowMs: HOUR,
    limit: 3,
    emitHeaders: false,
    keyGenerator: (req) => bodyKey(req, "email"),
    message:
      "Too many registration attempts for this email. Please try again later.",
  }),
];

export const verifyOtpLimiter = [
  createLimiter({
    prefix: "verify-otp:ip",
    windowMs: 15 * MINUTE,
    limit: 20,
    skipSuccessfulRequests: true,
    message: AUTH_MESSAGE,
  }),
  createLimiter({
    prefix: "verify-otp:token",
    windowMs: 15 * MINUTE,
    limit: 10,
    skipSuccessfulRequests: true,
    emitHeaders: false,
    keyGenerator: (req) =>
      bodyKey(req, "registrationToken"),
    message:
      "Too many verification attempts. Please request a new code.",
  }),
];

export const resendOtpLimiter = [
  createLimiter({
    prefix: "resend-otp:ip",
    windowMs: HOUR,
    limit: 10,
    message: AUTH_MESSAGE,
  }),
  createLimiter({
    prefix: "resend-otp:token",
    windowMs: HOUR,
    limit: 3,
    emitHeaders: false,
    keyGenerator: (req) =>
      bodyKey(req, "registrationToken"),
    message:
      "Too many verification codes requested. Please try again later.",
  }),
];

export const refreshTokenLimiter = createLimiter({
  prefix: "refresh-token",
  windowMs: 15 * MINUTE,
  limit: 60,
  message: AUTH_MESSAGE,
});

export const checkoutLimiter = createLimiter({
  prefix: "checkout",
  windowMs: 15 * MINUTE,
  limit: 15,
  keyGenerator: userKey,
  message:
    "Too many checkout attempts. Please try again in a few minutes.",
});

export const verifyPaymentLimiter = createLimiter({
  prefix: "verify-payment",
  windowMs: 15 * MINUTE,
  limit: 30,
  keyGenerator: userKey,
  message:
    "Too many payment verification attempts. Please try again in a few minutes.",
});
