import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyAccessToken } from "../lib/jwt";
import { HttpError } from "../errors";

export type AuthedRequest = Request & {
  auth?: { userId: string; role: "CUSTOMER" | "ADMIN" };
};

export async function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return next(new HttpError(401, "Unauthorized"));
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isBlocked: true },
    });
    if (!user) return next(new HttpError(401, "Unauthorized"));
    if (user.isBlocked) return next(new HttpError(403, "Account blocked"));

    req.auth = { userId: user.id, role: user.role };
    return next();
  } catch {
    return next(new HttpError(401, "Unauthorized"));
  }
}

export function requireAdmin(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.auth) return next(new HttpError(401, "Unauthorized"));
  if (req.auth.role !== "ADMIN") return next(new HttpError(403, "Forbidden"));
  return next();
}

