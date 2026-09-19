// src/services/admin/stock-movement.service.ts

import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

import { Prisma } from "../../../generated/prisma/client";
import { StockMovementType } from "../../../generated/prisma/enums";

type TransactionClient = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

// ============================================================
// SHARED: lock + fetch variant row for update
// ============================================================

async function lockVariantForUpdate(
  tx: TransactionClient,
  productVariantId: number
) {
  const rows = await tx.$queryRaw<
    { id: number; stock: number }[]
  >`
    SELECT id, stock
    FROM "ProductVariant"
    WHERE id = ${productVariantId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new AppError("Product variant not found", 404);
  }

  return rows[0];
}


export const restockVariant = async (params: {
  productVariantId: number;
  quantity: number;
  supplierName?: string;
  unitCost?: number;
  batchNumber?: string;
}) => {
  const {
    productVariantId,
    quantity,
    supplierName,
    unitCost,
    batchNumber,
  } = params;

  if (quantity <= 0) {
    throw new AppError(
      "Restock quantity must be positive",
      400
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const variant = await lockVariantForUpdate(
        tx,
        productVariantId
      );

      const previousStock = variant.stock;
      const newStock = previousStock + quantity;

      await tx.productVariant.update({
        where: { id: productVariantId },
        data: { stock: newStock },
      });

      return tx.stockMovement.create({
        data: {
          productVariantId,
          type: StockMovementType.RESTOCK,
          change: quantity,
          previousStock,
          newStock,
          supplierName,
          unitCost:
            unitCost !== undefined
              ? new Prisma.Decimal(unitCost)
              : undefined,
          batchNumber,
        },
      });
    },
    {
      isolationLevel: "Serializable",
      maxWait: 5000,
      timeout: 10000,
    }
  );
};

// ============================================================
// MANUAL ADJUSTMENT
//
// Admin is correcting the stock number to a known-true value
// (e.g. after a physical count). Input is the TARGET value,
// not a delta — the delta is derived here, not by the caller.
// This avoids the "which direction do I add/subtract" bug.
// ============================================================

export const adjustVariantStock = async (params: {
  productVariantId: number;
  newStock: number;
  reason: string;
}) => {
  const { productVariantId, newStock, reason } = params;

  if (newStock < 0) {
    throw new AppError(
      "Stock cannot be negative",
      400
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const variant = await lockVariantForUpdate(
        tx,
        productVariantId
      );

      const previousStock = variant.stock;
      const change = newStock - previousStock;

      if (change === 0) {
        throw new AppError(
          "New stock value is the same as current stock — nothing to adjust",
          400
        );
      }

      await tx.productVariant.update({
        where: { id: productVariantId },
        data: { stock: newStock },
      });

      return tx.stockMovement.create({
        data: {
          productVariantId,
          type: StockMovementType.MANUAL_ADJUSTMENT,
          change,
          previousStock,
          newStock,
          reason,
        },
      });
    },
    {
      isolationLevel: "Serializable",
      maxWait: 5000,
      timeout: 10000,
    }
  );
};

// ============================================================
// LIST MOVEMENTS FOR A VARIANT
// (for the admin-facing history view)
// ============================================================

export const listStockMovements = async (params: {
  productVariantId: number;
  page: number;
  limit: number;
}) => {
  const { productVariantId, page, limit } = params;

  const [movements, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({
      where: { productVariantId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),

    prisma.stockMovement.count({
      where: { productVariantId },
    }),
  ]);

  const totalPages = Math.max(Math.ceil(total / limit), 1);

  return {
    movements,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};
