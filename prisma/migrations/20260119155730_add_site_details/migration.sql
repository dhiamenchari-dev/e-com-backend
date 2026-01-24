-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "currency" SET DEFAULT 'DT';

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "siteDescription" TEXT NOT NULL DEFAULT 'Modern e-commerce store',
ADD COLUMN     "siteName" TEXT NOT NULL DEFAULT 'Ecom';
