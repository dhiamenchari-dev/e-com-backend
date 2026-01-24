import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { HttpError } from "../errors";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { parsePagination } from "../utils/pagination";

export const ordersRouter = Router();

async function getCheckoutSettings(): Promise<{ shippingCents: number; discountPercent: number }> {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "singleton" } });
  return {
    shippingCents: settings?.shippingCents ?? 0,
    discountPercent: settings?.discountPercent ?? 0,
  };
}

function computeDiscountCents(subtotalCents: number, discountPercent: number): number {
  if (!Number.isFinite(discountPercent) || discountPercent <= 0) return 0;
  const pct = Math.max(0, Math.min(90, Math.trunc(discountPercent)));
  const cents = Math.round((subtotalCents * pct) / 100);
  return Math.max(0, Math.min(subtotalCents, cents));
}

function computeUnitPriceCents(product: {
  priceCents: number;
  discountValue: number | null;
  discountType: "PERCENTAGE" | "FIXED" | null;
}): number {
  const base = product.priceCents;
  const discountValue = product.discountValue;
  if (discountValue == null) return base;
  if (!Number.isFinite(discountValue) || discountValue <= 0) return base;

  if (product.discountType === "FIXED") {
    const discountCents = Math.round(discountValue * 100);
    return Math.max(0, base - discountCents);
  }

  if (product.discountType === "PERCENTAGE") {
    const pct = Math.max(0, Math.min(90, discountValue));
    const discountCents = Math.round((base * pct) / 100);
    return Math.max(0, base - discountCents);
  }

  return base;
}

const shippingSchema = z.object({
  fullName: z.string().min(2).max(80),
  phone: z.string().min(6).max(30),
  addressLine1: z.string().min(3).max(120),
  city: z.string().min(2).max(80),
  notes: z.string().max(500).optional().nullable(),
});

const guestCheckoutSchema = z.object({
  shipping: shippingSchema,
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(100),
});

/**
 * POST /api/orders/guest-checkout
 */
ordersRouter.post("/guest-checkout", async (req, res, next) => {
  try {
    const body = guestCheckoutSchema.parse(req.body);
    const shipping = body.shipping;

    const ids = Array.from(new Set(body.items.map((i) => i.productId)));
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        priceCents: true,
        discountValue: true,
        discountType: true,
        stock: true,
        isActive: true,
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const items = body.items.map((i) => {
      const product = byId.get(i.productId);
      if (!product || !product.isActive) throw new HttpError(404, "Not found");
      if (product.stock < i.quantity) throw new HttpError(400, "Out of stock");
      const unitPriceCents = computeUnitPriceCents(product);
      const lineTotalCents = unitPriceCents * i.quantity;
      return {
        productId: product.id,
        name: product.name,
        unitPriceCents,
        quantity: i.quantity,
        lineTotalCents,
      };
    });

    const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0);
    const { shippingCents, discountPercent } = await getCheckoutSettings();
    const discountCents = computeDiscountCents(subtotalCents, discountPercent);
    const totalCents = Math.max(0, subtotalCents - discountCents + shippingCents);

    const order = await prisma.$transaction(async (tx) => {
      for (const i of items) {
        await tx.product.update({
          where: { id: i.productId },
          data: { stock: { decrement: i.quantity } },
        });
      }

      return tx.order.create({
        data: {
          userId: null,
          currency: "DT",
          subtotalCents,
          discountCents,
          shippingCents,
          totalCents,
          shipping,
          items: { createMany: { data: items } },
          payment: {
            create: {
              method: "COD",
              status: "PENDING",
              amountCents: totalCents,
            },
          },
        },
        select: {
          id: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
        },
      });
    });

    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/public/:id
 */
ordersRouter.get("/public/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const order = await prisma.order.findFirst({
      where: { id, userId: null },
      select: {
        id: true,
        status: true,
        currency: true,
        subtotalCents: true,
        discountCents: true,
        shippingCents: true,
        totalCents: true,
        shipping: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            name: true,
            quantity: true,
            unitPriceCents: true,
            lineTotalCents: true,
            product: { select: { slug: true, images: true } },
          },
        },
        payment: { select: { method: true, status: true } },
      },
    });
    if (!order) throw new HttpError(404, "Not found");
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

ordersRouter.use(requireAuth);

/**
 * POST /api/orders/checkout
 */
ordersRouter.post("/checkout", async (req: AuthedRequest, res, next) => {
  try {
    const body: unknown = req.body;
    const shipping = shippingSchema.parse(
      (body as { shipping?: unknown } | undefined)?.shipping
    );
    const userId = req.auth!.userId;

    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: { product: true },
        },
      },
    });
    if (!cart || cart.items.length === 0) throw new HttpError(400, "Cart is empty");

    const items = cart.items.map((i) => {
      if (!i.product.isActive) throw new HttpError(400, "Product inactive");
      if (i.product.stock < i.quantity) throw new HttpError(400, "Out of stock");
      const unitPriceCents = computeUnitPriceCents(i.product);
      const lineTotalCents = unitPriceCents * i.quantity;
      return {
        productId: i.productId,
        name: i.product.name,
        unitPriceCents,
        quantity: i.quantity,
        lineTotalCents,
      };
    });

    const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0);
    const { shippingCents, discountPercent } = await getCheckoutSettings();
    const discountCents = computeDiscountCents(subtotalCents, discountPercent);
    const totalCents = Math.max(0, subtotalCents - discountCents + shippingCents);

    const order = await prisma.$transaction(async (tx) => {
      for (const cartItem of cart.items) {
        await tx.product.update({
          where: { id: cartItem.productId },
          data: { stock: { decrement: cartItem.quantity } },
        });
      }

      const created = await tx.order.create({
        data: {
          userId,
          currency: "DT",
          subtotalCents,
          discountCents,
          shippingCents,
          totalCents,
          shipping,
          items: { createMany: { data: items } },
          payment: {
            create: {
              method: "COD",
              status: "PENDING",
              amountCents: totalCents,
            },
          },
        },
        select: {
          id: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
        },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return created;
    });

    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/my
 */
ordersRouter.get("/my", async (req: AuthedRequest, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const userId = req.auth!.userId;

    const [total, items] = await Promise.all([
      prisma.order.count({ where: { userId } }),
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
          items: {
            take: 3,
            select: { id: true, name: true, quantity: true, unitPriceCents: true },
          },
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
 * GET /api/orders/:id
 */
ordersRouter.get("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        currency: true,
        subtotalCents: true,
        discountCents: true,
        shippingCents: true,
        totalCents: true,
        shipping: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            name: true,
            quantity: true,
            unitPriceCents: true,
            lineTotalCents: true,
            product: { select: { slug: true, images: true } },
          },
        },
        payment: { select: { method: true, status: true } },
        userId: true,
      },
    });
    if (!order) throw new HttpError(404, "Not found");
    if (order.userId !== req.auth!.userId && req.auth!.role !== "ADMIN") {
      throw new HttpError(403, "Forbidden");
    }
    res.json({ order });
  } catch (err) {
    next(err);
  }
});
