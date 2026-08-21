/*
  Warnings:

  - A unique constraint covering the columns `[sortOrder]` on the table `Size` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Size" ALTER COLUMN "sortOrder" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Size_sortOrder_key" ON "Size"("sortOrder");
