/*
  Warnings:

  - Added the required column `name` to the `Coupon` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "name" TEXT NOT NULL;
