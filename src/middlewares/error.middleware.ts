import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";
import AppError from "../errors/AppError";
import { Prisma } from "../../generated/prisma/client";
import {
  CONTENTION_MESSAGE,
  isRetryableTransactionError,
} from "../utils/transaction-retry.util";
import { logError } from "../utils/logger.util";

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: "One of the uploaded files is too large",
  LIMIT_FILE_COUNT: "Too many files were uploaded",
  LIMIT_UNEXPECTED_FILE: "Unexpected file field",
  LIMIT_PART_COUNT: "Too many parts in the upload",
  LIMIT_FIELD_KEY: "An upload field name is too long",
  LIMIT_FIELD_VALUE: "An upload field value is too long",
  LIMIT_FIELD_COUNT: "Too many upload fields",
};

/** 4xx errors raised by body-parser / http-errors (err.expose === true). */
const clientHttpError = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const { status, statusCode, expose, type } = error as {
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
    type?: unknown;
  };

  const code = typeof status === "number" ? status : statusCode;

  if (
    typeof code !== "number" ||
    code < 400 ||
    code >= 500 ||
    expose !== true
  ) {
    return null;
  }

  const messages: Record<string, string> = {
    "entity.parse.failed": "Malformed JSON in request body",
    "entity.too.large": "Request body is too large",
    "encoding.unsupported": "Unsupported content encoding",
    "charset.unsupported": "Unsupported charset",
    "request.aborted": "Request was aborted",
  };

  return {
    status: code,
    message:
      (typeof type === "string" && messages[type]) || "Bad request",
  };
};

/**
 * The database pool had no free connection in time (M14): transient
 * overload, not a bug — answer 503 so clients back off and retry.
 */
const isPoolSaturated = (error: unknown) => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2028"
  ) {
    return true;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "");

  return /timeout exceeded when trying to connect|Unable to start a transaction in the given time/i.test(
    message
  );
};

// Development-only escape hatch; start-up refuses it in production.
const exposeErrorDetails = () =>
  process.env.EXPOSE_ERROR_DETAILS === "true" &&
  process.env.NODE_ENV !== "production";

const errorMiddleware = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logError("request.failed", error, {
    method: req.method,
    path: req.path,
  });

  // Zod validation error
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (error instanceof MulterError) {
    return res.status(400).json({
      success: false,
      message:
        MULTER_MESSAGES[error.code] ??
        "Upload rejected",
    });
  }

  // Expected application error
  if (error instanceof AppError) {
    if (error.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }

    return res.status(error.statusCode).json({
      success: false,
      ...(error.code ? { code: error.code } : {}),
      message: error.message,
    });
  }

  if (isRetryableTransactionError(error)) {
    return res.status(409).json({
      success: false,
      code: "RETRY_LATER",
      message: CONTENTION_MESSAGE,
    });
  }

  if (isPoolSaturated(error)) {
    res.setHeader("Retry-After", "2");

    return res.status(503).json({
      success: false,
      message: "We're very busy right now. Please try again in a moment.",
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      return res.status(409).json({
        success: false,
        message:
          "This item is still in use by other records and cannot be removed. Deactivate it instead.",
      });
    }

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "The requested record was not found",
      });
    }
  }

  const clientError = clientHttpError(error);

  if (clientError) {
    return res.status(clientError.status).json({
      success: false,
      message: clientError.message,
    });
  }

  // Unexpected error: never leak internals unless explicitly asked to.
  if (exposeErrorDetails() && error instanceof Error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

export default errorMiddleware;
