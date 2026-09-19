/*
 * Admin audit trail (audit M9).
 *
 * Every successful (2xx/3xx) state-changing request by an ADMIN or
 * SUPER_ADMIN — and every view of a single customer's personal data — is
 * recorded with who, what, which entity, the (redacted) request, IP and
 * time. Recording happens once the response is finished, so a failed
 * request leaves no misleading entry; if writing the row fails, an alert is
 * logged instead of failing the admin's already-completed action.
 */
import { NextFunction, Request, Response } from "express";

import prisma from "../config/prisma";
import { logError } from "../utils/logger.util";

const SECRET_KEY = /password|token|secret|otp|code|signature|authorization/i;
const MAX_STRING = 10_000;

export const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 6) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[truncated]`
      : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        SECRET_KEY.test(key) ? "[redacted]" : redact(v, depth + 1),
      ])
    );
  }

  return value;
};

const SENSITIVE_READS: Array<{ baseUrl: string; route: string }> = [
  { baseUrl: "/api/v1/admin/customers", route: "/:id" },
];

const shouldRecord = (req: Request, res: Response) => {
  if (!req.user || req.user.role === "CUSTOMER") {
    return false;
  }

  if (res.statusCode >= 400) {
    return false;
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return true;
  }

  return SENSITIVE_READS.some(
    (read) => req.baseUrl === read.baseUrl && req.route?.path === read.route
  );
};

const record = async (req: Request, res: Response) => {
  const user = req.user!;
  const routePath =
    typeof req.route?.path === "string" ? req.route.path : req.path;
  // validate() may have coerced params (e.g. ids to numbers).
  const params = (req.params ?? {}) as Record<string, unknown>;
  const firstParam = Object.values(params)[0];

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: `${req.method} ${req.baseUrl}${routePath}`,
      entityType: req.baseUrl.split("/").filter(Boolean).pop() ?? null,
      entityId:
        firstParam === undefined || firstParam === null
          ? null
          : String(firstParam),
      statusCode: res.statusCode,
      requestData: redact({
        params,
        query: req.query,
        body: req.body,
      }) as object,
      ip: req.ip ?? null,
      userAgent: req.header("user-agent")?.slice(0, 500) ?? null,
      requestId: req.id ?? null,
    },
  });
};

export const auditAdminActions = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  res.on("finish", () => {
    if (!shouldRecord(req, res)) {
      return;
    }

    record(req, res).catch((error) =>
      logError("audit.write_failed", error, {
        requestId: req.id,
        alert: true,
      })
    );
  });

  next();
};
