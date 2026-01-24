import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { HttpError } from "../errors";
import { hashPassword, verifyPassword } from "../lib/password";
import { createRefreshToken, hashRefreshToken } from "../lib/refreshTokens";
import { signAccessToken } from "../lib/jwt";
import { env } from "../env";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.email(),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

function setRefreshCookie(res: Response, token: string) {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie("refreshToken", { path: "/api/auth" });
}

function getRefreshTokenCookie(req: Request): string | undefined {
  const cookies: unknown = (req as unknown as { cookies?: unknown }).cookies;
  const token = (cookies as { refreshToken?: unknown } | undefined)?.refreshToken;
  return z.string().min(1).optional().parse(token);
}

/**
 * POST /api/auth/register
 */
authRouter.post("/register", async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      select: { id: true },
    });
    if (existing) throw new HttpError(409, "Email already in use");

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash,
        cart: { create: {} },
      },
      select: { id: true, name: true, email: true, role: true },
    });

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const rt = createRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: rt.tokenHash,
        expiresAt: rt.expiresAt,
      },
    });
    setRefreshCookie(res, rt.token);

    res.status(201).json({ user, accessToken });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 */
authRouter.post("/login", async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      include: { cart: { select: { id: true } } },
    });
    if (!user) throw new HttpError(401, "Invalid credentials");
    if (user.isBlocked) throw new HttpError(403, "Account blocked");

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid credentials");

    if (!user.cart) {
      await prisma.cart.create({ data: { userId: user.id } });
    }

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const rt = createRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: rt.tokenHash,
        expiresAt: rt.expiresAt,
      },
    });
    setRefreshCookie(res, rt.token);

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/refresh
 */
authRouter.post("/refresh", async (req, res, next) => {
  try {
    const token = getRefreshTokenCookie(req);
    if (!token) throw new HttpError(401, "Unauthorized");

    const tokenHash = hashRefreshToken(token);
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, role: true, isBlocked: true } } },
    });
    if (!record) throw new HttpError(401, "Unauthorized");
    if (record.revokedAt) throw new HttpError(401, "Unauthorized");
    if (record.expiresAt.getTime() < Date.now())
      throw new HttpError(401, "Unauthorized");
    if (record.user.isBlocked) throw new HttpError(403, "Account blocked");

    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    const rt = createRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId: record.user.id,
        tokenHash: rt.tokenHash,
        expiresAt: rt.expiresAt,
      },
    });
    setRefreshCookie(res, rt.token);

    const accessToken = signAccessToken({
      sub: record.user.id,
      role: record.user.role,
    });

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 */
authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = getRefreshTokenCookie(req);
    if (token) {
      const tokenHash = hashRefreshToken(token);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearRefreshCookie(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 */
authRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    if (!user) throw new HttpError(401, "Unauthorized");
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

const updateMeSchema = z
  .object({
    email: z.email().optional(),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200).optional(),
  })
  .strict()
  .refine((v) => v.email !== undefined || v.newPassword !== undefined, {
    message: "Nothing to update",
  });

/**
 * PATCH /api/auth/me
 */
authRouter.patch("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = updateMeSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, name: true, email: true, role: true, passwordHash: true, createdAt: true },
    });
    if (!user) throw new HttpError(401, "Unauthorized");

    const ok = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid credentials");

    const nextEmail = body.email?.toLowerCase();
    if (nextEmail && nextEmail !== user.email) {
      const existing = await prisma.user.findUnique({
        where: { email: nextEmail },
        select: { id: true },
      });
      if (existing && existing.id !== user.id) throw new HttpError(409, "Email already in use");
    }

    const passwordHash = body.newPassword ? await hashPassword(body.newPassword) : undefined;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        email: nextEmail && nextEmail !== user.email ? nextEmail : undefined,
        passwordHash,
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});
