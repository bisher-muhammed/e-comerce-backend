import prisma from "../config/prisma";
import AppError from "../errors/AppError";
import { Prisma } from "../../generated/prisma/client";
import { StockMovementType } from "../../generated/prisma/enums";

type TransactionClient = Parameters<
    Parameters<typeof prisma.$transaction>[0]
>[0];

export interface StockMovement {
    productVariantId: number;
    quantity: number;
    orderItemId?: number;
}

function totalsByVariant(
    movements: StockMovement[]
): Map<number, { quantity: number; orderItemId?: number }> {
    const totals = new Map<
        number,
        { quantity: number; orderItemId?: number }
    >();

    for (const movement of movements) {
        if (movement.quantity <= 0) {
            continue;
        }

        const existing = totals.get(
            movement.productVariantId
        );

        totals.set(movement.productVariantId, {
            quantity:
                (existing?.quantity ?? 0) +
                movement.quantity,
            orderItemId:
                existing?.orderItemId ??
                movement.orderItemId,
        });
    }

    return totals;
}

function valuesList(
    totals: Map<
        number,
        { quantity: number; orderItemId?: number }
    >
): Prisma.Sql {
    return Prisma.join(
        [...totals]
            .sort(([a], [b]) => a - b)
            .map(
                ([productVariantId, { quantity }]) =>
                    Prisma.sql`(${productVariantId}::int, ${quantity}::int)`
            )
    );
}

async function writeMovements(
    tx: TransactionClient,
    rows: Array<{ id: number; stock: number }>,
    totals: Map<
        number,
        { quantity: number; orderItemId?: number }
    >,
    type: StockMovementType,
    computePreviousStock: (
        newStock: number,
        quantity: number
    ) => number,
    isDecrement: boolean
): Promise<void> {
    await tx.stockMovement.createMany({
        data: rows.map((row) => {
            const entry = totals.get(row.id)!;
            const previousStock = computePreviousStock(
                row.stock,
                entry.quantity
            );

            return {
                productVariantId: row.id,
                type,
                change: isDecrement
                    ? -entry.quantity
                    : entry.quantity,
                previousStock,
                newStock: row.stock,
                orderItemId: entry.orderItemId ?? null,
            };
        }),
    });
}

// ============================================================
// RESERVE (order placed)
// ============================================================

export async function reserveStockOrThrow(
    tx: TransactionClient,
    items: Array<
        StockMovement & {
            productName: string;
        }
    >
): Promise<void> {
    const totals = totalsByVariant(items);

    if (totals.size === 0) {
        return;
    }

    const reserved = await tx.$queryRaw<
        Array<{ id: number; stock: number }>
    >`
        UPDATE "ProductVariant" AS pv
        SET "stock" = pv."stock" - v.quantity,
            "updatedAt" = NOW()
        FROM (VALUES ${valuesList(totals)}) AS v(id, quantity)
        WHERE pv."id" = v.id
          AND pv."stock" >= v.quantity
        RETURNING pv."id", pv."stock"
    `;

    if (reserved.length !== totals.size) {
        const reservedIds = new Set(
            reserved.map((row) => row.id)
        );

        const shortItem = items.find(
            (item) =>
                item.quantity > 0 &&
                !reservedIds.has(item.productVariantId)
        );

        throw new AppError(
            `${shortItem?.productName ?? "An item"} no longer has enough stock`,
            409
        );
    }

    await writeMovements(
        tx,
        reserved,
        totals,
        StockMovementType.ORDER_PLACED,
        (newStock, quantity) => newStock + quantity,
        true
    );
}


export async function releaseStock(
    tx: TransactionClient,
    movements: StockMovement[],
    type:
        | typeof StockMovementType.ORDER_CANCELLED
        | typeof StockMovementType.ORDER_RETURNED
): Promise<void> {
    const totals = totalsByVariant(movements);

    if (totals.size === 0) {
        return;
    }

    const updated = await tx.$queryRaw<
        Array<{ id: number; stock: number }>
    >`
        UPDATE "ProductVariant" AS pv
        SET "stock" = pv."stock" + v.quantity,
            "updatedAt" = NOW()
        FROM (VALUES ${valuesList(totals)}) AS v(id, quantity)
        WHERE pv."id" = v.id
        RETURNING pv."id", pv."stock"
    `;

    await writeMovements(
        tx,
        updated,
        totals,
        type,
        (newStock, quantity) => newStock - quantity,
        false
    );
}

