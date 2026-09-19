// src/services/admin/stock-movement.service.ts

import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

import { Prisma } from "../../../generated/prisma/client";
import { StockMovementType } from "../../../generated/prisma/enums";
import {
  isUniqueConstraintOn,
  withTransactionRetry,
} from "../../utils/transaction-retry.util";
import { logError, logInfo } from "../../utils/logger.util";

type TransactionClient = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

type Movement = Prisma.StockMovementGetPayload<{}>;

export interface MovementResult {
  movement: Movement;
  /** True when the idempotency key had already been used (no change made). */
  replayed: boolean;
}

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

/**
 * Idempotent admin stock operations (M11): the same key returns the movement
 * it created the first time; the same key with different details is refused
 * rather than silently ignored.
 */
async function runIdempotent(
  productVariantId: number,
  idempotencyKey: string | undefined,
  matches: (existing: Movement) => boolean,
  apply: () => Promise<Movement>
): Promise<MovementResult> {
  const replay = async () => {
    if (!idempotencyKey) {
      return null;
    }

    const existing = await prisma.stockMovement.findUnique({
      where: {
        productVariantId_idempotencyKey: {
          productVariantId,
          idempotencyKey,
        },
      },
    });

    if (!existing) {
      return null;
    }

    if (!matches(existing)) {
      throw new AppError(
        "This idempotency key was already used for a different stock change",
        409
      );
    }

    return { movement: existing, replayed: true };
  };

  const earlier = await replay();

  if (earlier) {
    return earlier;
  }

  try {
    return {
      movement: await withTransactionRetry(apply),
      replayed: false,
    };
  } catch (error) {
    if (isUniqueConstraintOn(error, "idempotencyKey")) {
      const raced = await replay();

      if (raced) {
        return raced;
      }
    }

    throw error;
  }
}

const TX_OPTIONS = {
  isolationLevel: "Serializable" as const,
  maxWait: 5000,
  timeout: 10000,
};

export const restockVariant = async (params: {
  productVariantId: number;
  quantity: number;
  supplierName?: string;
  unitCost?: number;
  batchNumber?: string;
  idempotencyKey?: string;
}): Promise<MovementResult> => {
  const {
    productVariantId,
    quantity,
    supplierName,
    unitCost,
    batchNumber,
    idempotencyKey,
  } = params;

  if (quantity <= 0) {
    throw new AppError(
      "Restock quantity must be positive",
      400
    );
  }

  return runIdempotent(
    productVariantId,
    idempotencyKey,
    (existing) =>
      existing.type === StockMovementType.RESTOCK &&
      existing.change === quantity,
    () =>
      prisma.$transaction(async (tx) => {
        const variant = await lockVariantForUpdate(tx, productVariantId);

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
            idempotencyKey,
          },
        });
      }, TX_OPTIONS)
  );
};

// ============================================================
// MANUAL ADJUSTMENT
//
// Admin is correcting the stock number to a known-true value
// (e.g. after a physical count). Input is the TARGET value,
// not a delta — the delta is derived here, not by the caller.
//
// `expectedStock` (recommended) is the number the admin was looking at:
// if sales or cancellations changed it since, the adjustment is refused
// with 409 instead of silently undoing them (compare-and-set, M11/H3).
// ============================================================

export const adjustVariantStock = async (params: {
  productVariantId: number;
  newStock: number;
  reason: string;
  expectedStock?: number;
  idempotencyKey?: string;
}): Promise<MovementResult> => {
  const {
    productVariantId,
    newStock,
    reason,
    expectedStock,
    idempotencyKey,
  } = params;

  if (newStock < 0) {
    throw new AppError(
      "Stock cannot be negative",
      400
    );
  }

  return runIdempotent(
    productVariantId,
    idempotencyKey,
    (existing) =>
      existing.type === StockMovementType.MANUAL_ADJUSTMENT &&
      existing.newStock === newStock,
    () =>
      prisma.$transaction(async (tx) => {
        const variant = await lockVariantForUpdate(tx, productVariantId);

        const previousStock = variant.stock;

        if (
          expectedStock !== undefined &&
          expectedStock !== previousStock
        ) {
          throw new AppError(
            `Stock changed to ${previousStock} since you loaded it (expected ${expectedStock}). Review and try again.`,
            409,
            "STOCK_CHANGED"
          );
        }

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
            idempotencyKey,
          },
        });
      }, TX_OPTIONS)
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

// ============================================================
// RECONCILIATION (M11)
//
// Every stock change is ledgered, so for each variant
// Σ(change) must equal the stock column. Anything else is an
// unrecorded change (a bug or a manual DB edit) and is alerted.
// ============================================================

export const findStockLedgerMismatches = async () =>
  prisma.$queryRaw<
    Array<{ productVariantId: number; stock: number; ledger: number }>
  >`
    SELECT pv."id" AS "productVariantId",
           pv."stock",
           COALESCE(SUM(sm."change"), 0)::int AS ledger
      FROM "ProductVariant" pv
      LEFT JOIN "StockMovement" sm ON sm."productVariantId" = pv."id"
     GROUP BY pv."id", pv."stock"
    HAVING pv."stock" <> COALESCE(SUM(sm."change"), 0)
     ORDER BY pv."id"
     LIMIT 500
  `;

let reconcileTimer: NodeJS.Timeout | null = null;

export function startStockReconciliation(
  intervalMs = 24 * 60 * 60 * 1000
) {
  if (reconcileTimer) {
    return;
  }

  const tick = async () => {
    try {
      const mismatches = await findStockLedgerMismatches();

      if (mismatches.length > 0) {
        logError(
          "stock_ledger.mismatch",
          new Error(`${mismatches.length} variant(s) disagree with the ledger`),
          {
            count: mismatches.length,
            firstVariantId: mismatches[0].productVariantId,
            alert: true,
          }
        );
      } else {
        logInfo("stock_ledger.reconciled");
      }
    } catch (error) {
      logError("stock_ledger.reconcile_failed", error, { alert: true });
    }
  };

  reconcileTimer = setInterval(tick, intervalMs);
  reconcileTimer.unref();
  void tick();
}

export function stopStockReconciliation() {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
}
