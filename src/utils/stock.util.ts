import prisma from "../config/prisma";
import AppError from "../errors/AppError";
import { Prisma } from "../../generated/prisma/client";

type TransactionClient = Parameters<
    Parameters<typeof prisma.$transaction>[0]
>[0];

export type RawClient = Pick<
    TransactionClient,
    "$queryRaw" | "$executeRaw"
>;

export interface StockMovement {
    productVariantId: number;
    quantity: number;
}

function totalsByVariant(
    movements: StockMovement[]
): Map<number, number> {
    const totals = new Map<number, number>();

    for (const movement of movements) {
        if (movement.quantity <= 0) {
            continue;
        }

        totals.set(
            movement.productVariantId,
            (totals.get(
                movement.productVariantId
            ) ?? 0) + movement.quantity
        );
    }

    return totals;
}

function valuesList(
    totals: Map<number, number>
): Prisma.Sql {
    return Prisma.join(
        [...totals]
            .sort(([a], [b]) => a - b)
            .map(
                ([
                    productVariantId,
                    quantity,
                ]) =>
                    Prisma.sql`(${productVariantId}::int, ${quantity}::int)`
            )
    );
}

export async function reserveStockOrThrow(
    tx: RawClient,
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
        Array<{ id: number }>
    >`
        UPDATE "ProductVariant" AS pv
        SET "stock" = pv."stock" - v.quantity,
            "updatedAt" = NOW()
        FROM (VALUES ${valuesList(totals)}) AS v(id, quantity)
        WHERE pv."id" = v.id
          AND pv."stock" >= v.quantity
        RETURNING pv."id"
    `;

    if (reserved.length === totals.size) {
        return;
    }

    const reservedIds = new Set(
        reserved.map((row) => row.id)
    );

    const shortItem = items.find(
        (item) =>
            item.quantity > 0 &&
            !reservedIds.has(
                item.productVariantId
            )
    );

    throw new AppError(
        `${shortItem?.productName ?? "An item"} no longer has enough stock`,
        409
    );
}

export async function releaseStock(
    tx: RawClient,
    movements: StockMovement[]
): Promise<void> {
    const totals =
        totalsByVariant(movements);

    if (totals.size === 0) {
        return;
    }

    await tx.$executeRaw`
        UPDATE "ProductVariant" AS pv
        SET "stock" = pv."stock" + v.quantity,
            "updatedAt" = NOW()
        FROM (VALUES ${valuesList(totals)}) AS v(id, quantity)
        WHERE pv."id" = v.id
    `;
}
