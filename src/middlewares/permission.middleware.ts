import { NextFunction, Request, Response } from "express";

import AppError from "../errors/AppError";
import { hasPermission, type Permission } from "../utils/permissions.util";

const deny = (next: NextFunction, permission: Permission) =>
  next(
    new AppError(
      "You do not have permission to perform this action",
      403,
      "PERMISSION_DENIED"
    )
  );

/** Requires every listed permission. Runs after authenticateAdmin. */
export const requirePermission =
  (...permissions: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError("Authentication required", 401));
    }

    const missing = permissions.find((p) => !hasPermission(req.user!, p));

    return missing ? deny(next, missing) : next();
  };

/** `read` for GET/HEAD, `write` for everything else. */
export const permitByMethod =
  (read: Permission, write: Permission) =>
  (req: Request, res: Response, next: NextFunction) =>
    requirePermission(
      req.method === "GET" || req.method === "HEAD" ? read : write
    )(req, res, next);

/** Requires `permission` only when the request matches `when`. */
export const requirePermissionWhen =
  (when: (req: Request) => boolean, permission: Permission) =>
  (req: Request, res: Response, next: NextFunction) =>
    when(req) ? requirePermission(permission)(req, res, next) : next();
