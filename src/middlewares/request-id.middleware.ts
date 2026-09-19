import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";

const VALID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Gives every request a correlation id (M9 audit rows, M17 logs). An id
 * sent by a trusted proxy is kept when well-formed, otherwise one is made.
 */
export const requestId = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const incoming = req.header("x-request-id");

  req.id = incoming && VALID.test(incoming) ? incoming : randomUUID();

  res.setHeader("X-Request-Id", req.id);

  next();
};
