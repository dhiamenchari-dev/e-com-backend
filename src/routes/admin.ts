import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth, type AuthedRequest } from "../middlewares/auth";
import { HttpError } from "../errors";
import { env } from "../env";
import { parsePagination } from "../utils/pagination";
import { slugify } from "../utils/slug";
import { cloudinary } from "../lib/cloudinary";

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

const siteSettingsSelect = {
  id: true,
  siteName: true,
  siteDescription: true,
  logoUrl: true,
  logoPublicId: true,
  logoHeightPx: true,
  primaryColor: true,
  accentColor: true,
  shippingCents: true,
  discountPercent: true,
  fireEnabled: true,
  fireIntensity: true,
  heroHeadline: true,
  heroHeadline2: true,
  heroSubtitle: true,
  heroHeadlineColor: true,
  heroHeadlineColor1: true,
  heroHeadlineColor2: true,
  updatedAt: true,
} satisfies Prisma.SiteSettingsSelect;

function fallbackProductSlug(): string {
  return `product-${crypto.randomUUID().slice(0, 8)}`;
}

async function ensureUniqueProductSlug(base: string, excludeId?: string): Promise<string> {
  const cleanBase = base || fallbackProductSlug();
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? cleanBase : `${cleanBase}-${i + 1}`;
    const existing = await prisma.product.findFirst({
      where: excludeId ? { slug: candidate, NOT: { id: excludeId } } : { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `${cleanBase}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * GET /api/admin/stats
 */
adminRouter.get("/stats", async (_req, res, next) => {
  try {
    const [users, orders, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.order.count(),
      prisma.order.aggregate({
        where: { status: { in: ["PAID", "SHIPPED", "COMPLETED"] } },
        _sum: { totalCents: true },
      }),
    ]);

    res.json({
      users,
      orders,
      revenueCents: revenue._sum.totalCents ?? 0,
      currency: "DT",
    });
  } catch (err) {
    next(err);
  }
});

const settingsUpdateSchema = z
  .object({
    siteName: z.string().max(50).optional(),
    siteDescription: z.string().max(200).optional(),
    logoUrl: z.url().nullable().optional(),
    logoPublicId: z.string().min(1).nullable().optional(),
    logoHeightPx: z.coerce.number().int().min(1).max(512).optional(),
    primaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
    accentColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
    shippingCents: z.coerce.number().int().min(0).max(10_000_000).optional(),
    discountPercent: z.coerce.number().int().min(0).max(90).optional(),
    fireEnabled: z.coerce.boolean().optional(),
    fireIntensity: z.coerce.number().int().min(0).max(100).optional(),
    heroHeadline: z.string().max(100).optional(),
    heroHeadline2: z.string().max(200).optional(),
    heroSubtitle: z.string().max(500).optional(),
    heroHeadlineColor: z
      .string()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      .nullable()
      .optional(),
    heroHeadlineColor1: z
      .string()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      .nullable()
      .optional(),
    heroHeadlineColor2: z
      .string()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      .nullable()
      .optional(),
  })
  .strict();

/**
 * GET /api/admin/settings
 */
adminRouter.get("/settings", async (_req, res, next) => {
  try {
    const settings = await prisma.siteSettings.upsert({
      where: { id: "singleton" },
      create: { 
        id: "singleton",
        siteName: "Ecom",
        siteDescription: "Modern e-commerce store",
        primaryColor: "#111827",
        accentColor: "#2563eb",
        fireEnabled: true,
        fireIntensity: 60,
      },
      update: {},
      select: siteSettingsSelect,
    });
    res.json({ settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const name = err instanceof Error ? err.name : "UnknownError";
    if (env.NODE_ENV !== "production") {
      res.status(500).json({ error: { message, name } });
      return;
    }
    next(err);
  }
});

/**
 * PUT /api/admin/settings
 */
adminRouter.put("/settings", async (req, res, next) => {
  try {
    const body = settingsUpdateSchema.parse(req.body);
    const updated = await prisma.siteSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        siteName: body.siteName ?? "Ecom",
        siteDescription: body.siteDescription ?? "Modern e-commerce store",
        logoUrl: body.logoUrl ?? null,
        logoPublicId: body.logoPublicId ?? null,
        logoHeightPx: body.logoHeightPx,
        primaryColor: body.primaryColor,
        accentColor: body.accentColor,
        shippingCents: body.shippingCents,
        discountPercent: body.discountPercent,
        fireEnabled: body.fireEnabled,
        fireIntensity: body.fireIntensity,
        heroHeadline: body.heroHeadline,
        heroHeadline2: body.heroHeadline2,
        heroSubtitle: body.heroSubtitle,
        heroHeadlineColor: body.heroHeadlineColor,
        heroHeadlineColor1: body.heroHeadlineColor1 ?? body.heroHeadlineColor,
        heroHeadlineColor2: body.heroHeadlineColor2,
      },
      update: {
        siteName: body.siteName,
        siteDescription: body.siteDescription,
        logoUrl: body.logoUrl === undefined ? undefined : body.logoUrl,
        logoPublicId: body.logoPublicId === undefined ? undefined : body.logoPublicId,
        logoHeightPx: body.logoHeightPx,
        primaryColor: body.primaryColor,
        accentColor: body.accentColor,
        shippingCents: body.shippingCents,
        discountPercent: body.discountPercent,
        fireEnabled: body.fireEnabled,
        fireIntensity: body.fireIntensity,
        heroHeadline: body.heroHeadline,
        heroHeadline2: body.heroHeadline2,
        heroSubtitle: body.heroSubtitle,
        heroHeadlineColor: body.heroHeadlineColor === undefined ? undefined : body.heroHeadlineColor,
        heroHeadlineColor1:
          body.heroHeadlineColor1 === undefined ? undefined : body.heroHeadlineColor1 ?? body.heroHeadlineColor,
        heroHeadlineColor2: body.heroHeadlineColor2 === undefined ? undefined : body.heroHeadlineColor2,
      },
      select: siteSettingsSelect,
    });
    res.json({ settings: updated });
  } catch (err) {
    next(err);
  }
});

const categorySchema = z.object({ name: z.string().min(2).max(60) });

/**
 * POST /api/admin/categories
 */
adminRouter.post("/categories", async (req, res, next) => {
  try {
    const body = categorySchema.parse(req.body);
    const created = await prisma.category.create({
      data: { name: body.name.trim() },
      select: { id: true, name: true },
    });
    res.status(201).json({ category: created });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/categories/:id
 */
adminRouter.patch("/categories/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const body = categorySchema.parse(req.body);
    const updated = await prisma.category.update({
      where: { id },
      data: { name: body.name.trim() },
      select: { id: true, name: true },
    });
    res.json({ category: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/categories/:id
 */
adminRouter.delete("/categories/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const count = await prisma.product.count({ where: { categoryId: id } });
    if (count > 0) throw new HttpError(400, "Category has products");
    await prisma.category.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const imagesSchema = z
  .array(
    z.object({
      url: z.url(),
      publicId: z.string().min(1).optional(),
    })
  )
  .default([]);

const productCreateSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(140).optional(),
  description: z.string().min(10).max(5000),
  price: z.coerce.number().positive(),
  stock: z.coerce.number().int().min(0).max(100000),
  categoryId: z.string().min(1),
  images: imagesSchema.optional(),
  isActive: z.boolean().optional(),
  shippingCents: z.coerce.number().int().min(0).optional().nullable(),
  discountValue: z.coerce.number().min(0).optional().nullable(),
  discountType: z.enum(["PERCENTAGE", "FIXED"]).optional().nullable(),
});

/**
 * POST /api/admin/products
 */
adminRouter.post("/products", async (req, res, next) => {
  try {
    const body = productCreateSchema.parse(req.body);
    const name = body.name.trim();
    const description = body.description.trim();
    const baseSlug = body.slug ? slugify(body.slug) : slugify(name);
    const slug = await ensureUniqueProductSlug(baseSlug);

    const category = await prisma.category.findUnique({
      where: { id: body.categoryId },
      select: { id: true },
    });
    if (!category) throw new HttpError(400, "Invalid category");

    const created = await prisma.product.create({
      data: {
        name,
        slug,
        description,
        priceCents: Math.round(body.price * 100),
        stock: body.stock,
        categoryId: body.categoryId,
        images: body.images ?? [],
        isActive: body.isActive ?? true,
        shippingCents: body.shippingCents,
        discountValue: body.discountValue,
        discountType: body.discountType,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        priceCents: true,
        stock: true,
        images: true,
        isActive: true,
        shippingCents: true,
        discountValue: true,
        discountType: true,
        category: { select: { id: true, name: true } },
      },
    });
    res.status(201).json({ product: created });
  } catch (err) {
    next(err);
  }
});

const productUpdateSchema = productCreateSchema.partial();

/**
 * PATCH /api/admin/products/:id
 */
adminRouter.patch("/products/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const body = productUpdateSchema.parse(req.body);
    const data: Prisma.ProductUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.description !== undefined) data.description = body.description.trim();
    if (body.price !== undefined) data.priceCents = Math.round(body.price * 100);
    if (body.stock !== undefined) data.stock = body.stock;
    if (body.categoryId !== undefined) {
      const category = await prisma.category.findUnique({
        where: { id: body.categoryId },
        select: { id: true },
      });
      if (!category) throw new HttpError(400, "Invalid category");
      data.categoryId = body.categoryId;
    }
    if (body.images !== undefined)
      data.images = body.images as unknown as Prisma.InputJsonValue;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.shippingCents !== undefined) data.shippingCents = body.shippingCents;
    if (body.discountValue !== undefined) data.discountValue = body.discountValue;
    if (body.discountType !== undefined) data.discountType = body.discountType;
    if (body.slug !== undefined) {
      const baseSlug = slugify(body.slug);
      if (!baseSlug) throw new HttpError(400, "Invalid slug");
      const nextSlug = await ensureUniqueProductSlug(baseSlug, id);
      data.slug = nextSlug;
    }

    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new HttpError(404, "Not found");

    const updated = await prisma.product.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        priceCents: true,
        stock: true,
        images: true,
        isActive: true,
        shippingCents: true,
        discountValue: true,
        discountType: true,
        category: { select: { id: true, name: true } },
      },
    });
    res.json({ product: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/products/:id
 */
adminRouter.delete("/products/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const hard = z
      .enum(["true", "false"])
      .optional()
      .parse((req.query as { hard?: unknown } | undefined)?.hard);

    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new HttpError(404, "Not found");

    if (hard === "true") {
      const orderRefs = await prisma.orderItem.count({
        where: { productId: id, order: { status: { not: "CANCELED" } } },
      });
      if (orderRefs > 0) throw new HttpError(400, "Product has orders");
      await prisma.cartItem.deleteMany({ where: { productId: id } });
      await prisma.product.delete({ where: { id } });
      res.status(204).end();
      return;
    }

    await prisma.product.update({ where: { id }, data: { isActive: false } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/products
 */
adminRouter.get("/products", async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const [total, items] = await Promise.all([
      prisma.product.count(),
      prisma.product.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          priceCents: true,
          stock: true,
          isActive: true,
          category: { select: { id: true, name: true } },
          createdAt: true,
        },
      }),
    ]);
    res.json({ page, limit, total, totalPages: Math.ceil(total / limit), items });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/orders
 */
adminRouter.get("/orders", async (req, res, next) => {
  try {
    const status = z
      .enum(["PENDING", "PAID", "SHIPPED", "COMPLETED", "CANCELED"])
      .optional()
      .parse(req.query.status);
    const { page, limit, skip } = parsePagination(req.query);

    const where = status ? { status } : {};
    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true } },
          shipping: true,
        },
      }),
    ]);

    res.json({ page, limit, total, totalPages: Math.ceil(total / limit), items });
  } catch (err) {
    next(err);
  }
});

const orderStatusSchema = z.object({
  status: z.enum(["PENDING", "PAID", "SHIPPED", "COMPLETED", "CANCELED"]),
});

/**
 * GET /api/admin/orders/:id
 */
adminRouter.get("/orders/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        totalCents: true,
        subtotalCents: true,
        shippingCents: true,
        discountCents: true,
        currency: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
        shipping: true,
        items: {
          select: {
            id: true,
            productId: true,
            name: true,
            quantity: true,
            unitPriceCents: true,
            lineTotalCents: true,
          },
        },
      },
    });
    if (!order) throw new HttpError(404, "Order not found");
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/orders/:id
 */
adminRouter.patch("/orders/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const body = orderStatusSchema.parse(req.body);
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.order.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!existing) throw new HttpError(404, "Not found");

      if (existing.status !== "CANCELED" && body.status === "CANCELED") {
        for (const item of existing.items) {
          if (!item.productId) continue;
          await tx.product.updateMany({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await tx.payment.updateMany({
          where: { orderId: id },
          data: { status: "FAILED" },
        });
      }

      if (body.status === "PAID") {
        await tx.payment.updateMany({
          where: { orderId: id },
          data: { status: "PAID" },
        });
      }

      return tx.order.update({
        where: { id },
        data: { status: body.status },
        select: { id: true, status: true },
      });
    });

    res.json({ order: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users
 */
adminRouter.get("/users", async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const [total, items] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isBlocked: true,
          createdAt: true,
        },
      }),
    ]);
    res.json({ page, limit, total, totalPages: Math.ceil(total / limit), items });
  } catch (err) {
    next(err);
  }
});

const blockSchema = z.object({ blocked: z.boolean() });

/**
 * PATCH /api/admin/users/:id/block
 */
adminRouter.patch("/users/:id/block", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const body = blockSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id },
      data: { isBlocked: body.blocked },
      select: { id: true, isBlocked: true },
    });
    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/products/:id
 */
adminRouter.get("/products/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        priceCents: true,
        stock: true,
        images: true,
        isActive: true,
        shippingCents: true,
        discountValue: true,
        discountType: true,
        categoryId: true,
      },
    });
    if (!product) throw new HttpError(404, "Not found");
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

async function saveLocalProductImage(req: AuthedRequest, file: Express.Multer.File): Promise<{
  url: string;
  publicId: string;
}> {
  const ext = path.extname(file.originalname || "").slice(0, 10);
  const safeExt = /^[a-z0-9.]+$/i.test(ext) ? ext : "";
  const fallbackExt =
    file.mimetype === "image/jpeg"
      ? ".jpg"
      : file.mimetype === "image/png"
        ? ".png"
        : file.mimetype === "image/webp"
          ? ".webp"
          : file.mimetype === "image/gif"
            ? ".gif"
            : ".bin";
  const filename = `${crypto.randomUUID()}${safeExt || fallbackExt}`;
  const dir = path.join(process.cwd(), "uploads", "products");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), file.buffer);

  const origin = `${req.protocol}://${req.get("host")}`;
  return {
    url: `${origin}/uploads/products/${filename}`,
    publicId: `local:products/${filename}`,
  };
}

async function saveLocalLogo(req: AuthedRequest, file: Express.Multer.File): Promise<{
  url: string;
  publicId: string;
}> {
  const ext = path.extname(file.originalname || "").slice(0, 10);
  const safeExt = /^[a-z0-9.]+$/i.test(ext) ? ext : "";
  const fallbackExt =
    file.mimetype === "image/jpeg"
      ? ".jpg"
      : file.mimetype === "image/png"
        ? ".png"
        : file.mimetype === "image/webp"
          ? ".webp"
          : file.mimetype === "image/gif"
            ? ".gif"
            : ".bin";
  const filename = `${crypto.randomUUID()}${safeExt || fallbackExt}`;
  const dir = path.join(process.cwd(), "uploads", "site");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), file.buffer);

  const origin = `${req.protocol}://${req.get("host")}`;
  // Ensure we use the correct port for localhost development if needed, but req.get("host") should be sufficient.
  // However, if the client is accessing via localhost:4000 and the server thinks it's something else, we might need adjustment.
  // For now, let's stick to what works for products, but double check the path.
  // Windows paths might use backslashes, but URLs need forward slashes.
  return {
    url: `${origin}/uploads/site/${filename}`,
    publicId: `local:site/${filename}`,
  };
}

/**
 * POST /api/admin/uploads/product-image
 */
adminRouter.post(
  "/uploads/product-image",
  upload.single("file"),
  async (req: AuthedRequest, res, next) => {
    try {
      if (!req.file) throw new HttpError(400, "File required");
      const file = req.file;
      if (!file.mimetype?.startsWith("image/")) throw new HttpError(400, "Invalid file type");

      try {
        const uploadResult = await new Promise<unknown>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "ecom/products" },
            (error, result) => {
              if (error || !result) {
                const maybeErr: unknown = error;
                const err =
                  maybeErr instanceof Error ? maybeErr : new Error("Upload failed");
                reject(err);
                return;
              }
              resolve(result);
            }
          );
          stream.end(file.buffer);
        });

        const result = z
          .object({
            secure_url: z.url(),
            public_id: z.string().min(1),
          })
          .parse(uploadResult);

        res.status(201).json({
          image: { url: result.secure_url, publicId: result.public_id },
        });
        return;
      } catch {
        const local = await saveLocalProductImage(req, file);
        res.status(201).json({ image: local });
        return;
      }
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/uploads/logo
 */
adminRouter.post("/uploads/logo", upload.single("file"), async (req: AuthedRequest, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, "File required");
    const file = req.file;
    if (!file.mimetype?.startsWith("image/")) throw new HttpError(400, "Invalid file type");

    try {
      const uploadResult = await new Promise<unknown>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "ecom/site" },
          (error, result) => {
            if (error || !result) {
              const maybeErr: unknown = error;
              const err = maybeErr instanceof Error ? maybeErr : new Error("Upload failed");
              reject(err);
              return;
            }
            resolve(result);
          }
        );
        stream.end(file.buffer);
      });

      const result = z
        .object({
          secure_url: z.url(),
          public_id: z.string().min(1),
        })
        .parse(uploadResult);

      res.status(201).json({
        image: { url: result.secure_url, publicId: result.public_id },
      });
      return;
    } catch {
      const local = await saveLocalLogo(req, file);
      res.status(201).json({ image: local });
      return;
    }
  } catch (err) {
    next(err);
  }
});

const deleteImageSchema = z.object({
  publicId: z.string().min(1),
});

/**
 * DELETE /api/admin/uploads
 */
adminRouter.delete("/uploads", async (req, res, next) => {
  try {
    const body = deleteImageSchema.parse(req.body);
    if (body.publicId.startsWith("local:")) {
      const rel = body.publicId.slice("local:".length);
      const allowed = rel.startsWith("products/") || rel.startsWith("site/");
      if (!allowed || rel.includes("..")) {
        throw new HttpError(400, "Invalid publicId");
      }
      const fullPath = path.join(process.cwd(), "uploads", rel);
      await fs.unlink(fullPath).catch(() => undefined);
      res.status(204).end();
      return;
    }

    await cloudinary.uploader.destroy(body.publicId, { invalidate: true });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
