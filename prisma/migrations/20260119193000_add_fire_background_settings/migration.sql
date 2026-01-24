-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "fireEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "fireIntensity" INTEGER NOT NULL DEFAULT 60;

