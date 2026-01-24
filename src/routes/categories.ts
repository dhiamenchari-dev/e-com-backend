import { Router } from "express";
import { prisma } from "../lib/prisma";

export const categoriesRouter = Router();

/**
 * GET /api/categories
 */
categoriesRouter.get("/", async (_req, res, next) => {
  try {
    const items = await prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

