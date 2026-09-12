import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";
import AppError from "../errors/AppError";

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: "One of the uploaded files is too large",
  LIMIT_FILE_COUNT: "Too many files were uploaded",
  LIMIT_UNEXPECTED_FILE: "Unexpected file field",
  LIMIT_PART_COUNT: "Too many parts in the upload",
  LIMIT_FIELD_KEY: "An upload field name is too long",
  LIMIT_FIELD_VALUE: "An upload field value is too long",
  LIMIT_FIELD_COUNT: "Too many upload fields",
};

const errorMiddleware = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error("ERROR:", error);

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
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
  }

  // Unexpected error
  if (
    process.env.NODE_ENV !== "production" &&
    error instanceof Error
  ) {
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
