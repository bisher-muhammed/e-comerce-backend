import prisma from "../config/prisma";
import AppError from "../errors/AppError";
import { Prisma } from "../../generated/prisma/client";
import {
    releaseStock,
    type RawClient,
} from "./stock.util";

type TransactionClient = Parameters<
    Parameters<typeof prisma.$transaction>[0]
>[0];

type CancellationClient = RawClient &
    Pick<
        TransactionClient,
        "orderItemAction"
    >;

export interface CancellableOrderItem {
    id: number;
    productVariantId: number;
    remainingQuantity: number;
}

export async function cancelOrderItems(
    tx: CancellationClient,
    params: {
        orderId: number;
        items: CancellableOrderItem[];
        reason?: string | null;
        idempotencyKey: string;
    }
): Promise<void> {
    const {
        orderId,
        items,
        reason,
        idempotencyKey,
    } = params;

    if (items.length === 0) {
        return;
    }

    await tx.orderItemAction.createMany({
        data: items.map((item) => ({
            orderItemId: item.id,

            type: "CANCEL" as const,

            quantity: item.remainingQuantity,

            reason: reason ?? null,

            idempotencyKey,
        })),
    });

    const values = Prisma.join(
        [...items]
            .sort((a, b) => a.id - b.id)
            .map(
                (item) =>
                    Prisma.sql`(${item.id}::int, ${item.remainingQuantity}::int)`
            )
    );

    const cancelled = await tx.$queryRaw<
        Array<{ id: number }>
    >`
        UPDATE "OrderItem" AS oi
        SET "remainingQuantity" = oi."remainingQuantity" - v.quantity,
            "cancelledQuantity" = oi."cancelledQuantity" + v.quantity,
            "updatedAt" = NOW()
        FROM (VALUES ${values}) AS v(id, quantity)
        WHERE oi."id" = v.id
          AND oi."orderId" = ${orderId}
          AND oi."remainingQuantity" >= v.quantity
        RETURNING oi."id"
    `;

    if (cancelled.length !== items.length) {
        const cancelledIds = new Set(
            cancelled.map((row) => row.id)
        );

        const staleItem = items.find(
            (item) =>
                !cancelledIds.has(item.id)
        );

        throw new AppError(
            `Failed to cancel item ${staleItem!.id} — quantity changed concurrently`,
            409
        );
    }

    await releaseStock(
        tx,
        items.map((item) => ({
            productVariantId:
                item.productVariantId,

            quantity: item.remainingQuantity,
        }))
    );
}
