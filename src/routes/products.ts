import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { parsePagination } from "../utils/pagination";

export const productsRouter = Router();

const byIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
});

/**
 * POST /api/products/by-ids
 */
productsRouter.post("/by-ids", async (req, res, next) => {
  try {
    const body = byIdsSchema.parse(req.body);
    const ids = Array.from(new Set(body.ids));
    const items = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        slug: true,
        priceCents: true,
        discountValue: true,
        discountType: true,
        stock: true,
        images: true,
        isActive: true,
      },
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

const listQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  categoryId: z.string().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
  search: z.string().optional(),
});

/**
 * GET /api/products
 */
productsRouter.get("/", async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const { page, limit, skip } = parsePagination(q);

    const minPrice =
      q.minPrice !== undefined ? Math.round(Number(q.minPrice) * 100) : undefined;
    const maxPrice =
      q.maxPrice !== undefined ? Math.round(Number(q.maxPrice) * 100) : undefined;

    const where = {
      isActive: true,
      categoryId: q.categoryId,
      priceCents: {
        gte: Number.isFinite(minPrice) ? minPrice : undefined,
        lte: Number.isFinite(maxPrice) ? maxPrice : undefined,
      },
      OR: q.search
        ? [
            { name: { contains: q.search, mode: "insensitive" as const } },
            {
              description: { contains: q.search, mode: "insensitive" as const },
            },
          ]
        : undefined,
    };

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          priceCents: true,
          discountValue: true,
          discountType: true,
          stock: true,
          images: true,
          category: { select: { id: true, name: true } },
          createdAt: true,
        },
      }),
    ]);

    res.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/products/featured
 */
productsRouter.get("/featured", async (_req, res, next) => {
  try {
    const items = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        name: true,
        slug: true,
        priceCents: true,
        discountValue: true,
        discountType: true,
        images: true,
        category: { select: { id: true, name: true } },
      },
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/products/:slug
 */
productsRouter.get("/:slug", async (req, res, next) => {
  try {
    const slug = z.string().min(1).parse(req.params.slug);
    const product = await prisma.product.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        priceCents: true,
        discountValue: true,
        discountType: true,
        stock: true,
        images: true,
        category: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!product) return res.status(404).json({ error: { message: "Not found" } });
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

