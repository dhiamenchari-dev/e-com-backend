import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { env } from "../env";

export const settingsRouter = Router();

const publicSiteSettingsSelect = {
  siteName: true,
  siteDescription: true,
  logoUrl: true,
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

settingsRouter.get("/", async (_req, res, next) => {
  try {
    const settings = await prisma.siteSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
      select: publicSiteSettingsSelect,
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
