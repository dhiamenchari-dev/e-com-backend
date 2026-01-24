import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { HttpError } from "../errors";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { message: err.message, code: err.code, details: err.details },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    res.status(400).json({
      error: {
        message: "Database error",
        code: err.code,
        details: err.meta,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    const first = err.issues[0];
    const msg = first ? `${first.path.join(".")}: ${first.message}` : "Validation error";
    res.status(400).json({
      error: {
        message: msg,
        code: "VALIDATION_ERROR",
        details: err.issues,
      },
    });
    return;
  }

  res.status(500).json({ error: { message: "Internal server error" } });
}
