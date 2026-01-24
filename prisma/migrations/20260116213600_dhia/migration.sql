-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "logoUrl" TEXT,
    "logoPublicId" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#111827',
    "accentColor" TEXT NOT NULL DEFAULT '#2563eb',
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);
