import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";

type UserRole =
  | "CUSTOMER"
  | "ADMIN"
  | "SUPER_ADMIN";

export const authorize = (
  ...allowedRoles: UserRole[]
) => {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (!req.user) {
      return next(
        new AppError(
          "Authentication required",
          401
        )
      );
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          "You do not have permission to perform this action",
          403
        )
      );
    }

    next();
  };
};
