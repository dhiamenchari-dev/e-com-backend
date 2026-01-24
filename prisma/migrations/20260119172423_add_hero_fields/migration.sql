-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "discountType" "DiscountType",
ADD COLUMN     "discountValue" INTEGER,
ADD COLUMN     "shippingCents" INTEGER;

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "heroHeadline" TEXT NOT NULL DEFAULT 'Achetez',
ADD COLUMN     "heroHeadline2" TEXT NOT NULL DEFAULT 'des essentiels modernes avec livraison rapide.',
ADD COLUMN     "heroSubtitle" TEXT NOT NULL DEFAULT 'Découvrez les produits en vedette, gérez votre panier et passez commande en paiement à la livraison.';
