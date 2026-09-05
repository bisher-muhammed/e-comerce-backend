/*
  Warnings:

  - Made the column `contactEmail` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Made the column `contactPhone` on table `Order` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "contactEmail" SET NOT NULL,
ALTER COLUMN "contactPhone" SET NOT NULL;
