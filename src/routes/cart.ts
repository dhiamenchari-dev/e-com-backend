import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { prisma } from "../lib/prisma";

export const cartRouter = Router();

cartRouter.use(requireAuth);

async function getCartId(userId: string): Promise<string> {
  const cart = await prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  });
  return cart.id;
}

/**
 * GET /api/cart
 */
cartRouter.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const cartId = await getCartId(req.auth!.userId);
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      select: {
        id: true,
        items: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            quantity: true,
            product: {
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
            },
          },
        },
      },
    });
    res.json({ cart });
  } catch (err) {
    next(err);
  }
});

const addItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
});

/**
 * POST /api/cart/items
 */
cartRouter.post("/items", async (req: AuthedRequest, res, next) => {
  try {
    const body = addItemSchema.parse(req.body);
    const product = await prisma.product.findUnique({
      where: { id: body.productId },
      select: { id: true, stock: true, isActive: true },
    });
    if (!product || !product.isActive) throw new HttpError(404, "Not found");
    if (product.stock < body.quantity) throw new HttpError(400, "Out of stock");

    const cartId = await getCartId(req.auth!.userId);
    const existing = await prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId, productId: body.productId } },
      select: { id: true, quantity: true },
    });

    const nextQty = (existing?.quantity ?? 0) + body.quantity;
    if (nextQty > product.stock) throw new HttpError(400, "Out of stock");

    const item = await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId, productId: body.productId } },
      create: { cartId, productId: body.productId, quantity: body.quantity },
      update: { quantity: nextQty },
      select: { id: true, quantity: true },
    });

    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

const updateQtySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(99),
});

/**
 * PATCH /api/cart/items/:itemId
 */
cartRouter.patch("/items/:itemId", async (req: AuthedRequest, res, next) => {
  try {
    const itemId = z.string().min(1).parse(req.params.itemId);
    const body = updateQtySchema.parse(req.body);

    const cartId = await getCartId(req.auth!.userId);
    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
      select: { id: true, product: { select: { stock: true, isActive: true } } },
    });
    if (!item) throw new HttpError(404, "Not found");
    if (!item.product.isActive) throw new HttpError(400, "Product inactive");
    if (body.quantity > item.product.stock) throw new HttpError(400, "Out of stock");

    const updated = await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: body.quantity },
      select: { id: true, quantity: true },
    });
    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/cart/items/:itemId
 */
cartRouter.delete("/items/:itemId", async (req: AuthedRequest, res, next) => {
  try {
    const itemId = z.string().min(1).parse(req.params.itemId);
    const cartId = await getCartId(req.auth!.userId);
    const deleted = await prisma.cartItem.deleteMany({
      where: { id: itemId, cartId },
    });
    if (deleted.count === 0) throw new HttpError(404, "Not found");
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/cart/clear
 */
cartRouter.delete("/clear", async (req: AuthedRequest, res, next) => {
  try {
    const cartId = await getCartId(req.auth!.userId);
    await prisma.cartItem.deleteMany({ where: { cartId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
