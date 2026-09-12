import {
  Request,
  Response,
  NextFunction,
} from "express";

import { ZodType } from "zod";

import AppError from "../errors/AppError";

export type ValidatedSource =
  | "body"
  | "params"
  | "query";

interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

const SOURCES: ValidatedSource[] = [
  "body",
  "params",
  "query",
];

const replaceRequestSource = (
  req: Request,
  source: ValidatedSource,
  value: unknown
) => {
  Object.defineProperty(req, source, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
};

export const validate = (
  schemas: ValidationSchemas
) => {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const errors: {
      field: string;
      message: string;
    }[] = [];

    const accepted: Partial<
      Record<ValidatedSource, unknown>
    > = {};

    for (const source of SOURCES) {
      const schema = schemas[source];

      if (!schema) {
        continue;
      }

      const result = schema.safeParse(
        req[source]
      );

      if (!result.success) {
        errors.push(
          ...result.error.issues.map((issue) => ({
            field: `${source}.${issue.path.join(".")}`,
            message: issue.message,
          }))
        );

        continue;
      }

      accepted[source] = result.data;
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    req.validated = {
      ...req.validated,
      ...accepted,
    };

    for (const source of SOURCES) {
      if (source in accepted) {
        replaceRequestSource(
          req,
          source,
          accepted[source]
        );
      }
    }

    next();
  };
};

export const validated = <T>(
  req: Request,
  source: ValidatedSource
): T => {
  const bag = req.validated;

  if (!bag || !(source in bag)) {
    throw new AppError(
      `Request ${source} was not validated for this route`,
      500
    );
  }

  return bag[source] as T;
};
