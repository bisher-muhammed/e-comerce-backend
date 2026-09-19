import prisma from "../config/prisma";
import AppError from "../errors/AppError";
import { Prisma } from "../../generated/prisma/client";
import { StockMovementType } from "../../generated/prisma/enums";
import { releaseStock } from "./stock.util";
import { releaseCouponClaimForOrder } from "./coupon-redemption.util";
import {
    calculateCancellationAmounts,
    sumGrossCancelled,
} from "./order-amount.util";

type TransactionClient = Parameters<
    Parameters<typeof prisma.$transaction>[0]
>[0];

export interface CancellableOrderItem {
    id: number;
    productVariantId: number;
    remainingQuantity: number;
}

export async function cancelOrderItems(
    tx: TransactionClient,
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

    const cancelled = await tx.$queryRaw<Array<{ id: number }>>`
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

            orderItemId: item.id,
        })),
        StockMovementType.ORDER_CANCELLED
    );
}

/**
 * Cancels an online order that was never paid and gives back everything
 * it reserved: stock (ledgered as ORDER_CANCELLED per order item), the
 * coupon claim, and the cancelled amount on the order.
 *
 * The status transition is a conditional UPDATE, so a payment that is
 * confirmed concurrently wins and this returns false without touching
 * anything. Used by the expired-checkout sweeper and by a failed payment
 * initialisation; both must converge on the same end state.
 */
export async function cancelUnpaidPendingOrder(
    tx: TransactionClient,
    orderId: number,
    options: {
        reason: string;
        /** Stable per cause, so a retried release is recorded once. */
        idempotencyKey: string;
        /** Only cancel if the payment window has already closed. */
        onlyIfExpired?: boolean;
    }
): Promise<boolean> {
    const claimed = await tx.order.updateMany({
        where: {
            id: orderId,
            status: "PENDING",
            paymentStatus: "PENDING",
            ...(options.onlyIfExpired
                ? { expiresAt: { lte: new Date() } }
                : {}),
        },
        data: {
            status: "CANCELLED",
            cancellationReason: options.reason,
        },
    });

    if (claimed.count === 0) {
        return false;
    }

    const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
            subtotal: true,
            couponDiscount: true,
            cancelledAmount: true,
            items: {
                select: {
                    id: true,
                    price: true,
                    productVariantId: true,
                    remainingQuantity: true,
                    cancelledQuantity: true,
                },
            },
        },
    });

    const activeItems = order.items.filter(
        (item) => item.remainingQuantity > 0
    );

    if (activeItems.length > 0) {
        const grossCancelledNow = activeItems.reduce(
            (sum, item) =>
                sum.add(item.price.mul(item.remainingQuantity)),
            new Prisma.Decimal(0)
        );

        const { netCancellationAmount } =
            calculateCancellationAmounts({
                subtotal: order.subtotal,
                couponDiscount: order.couponDiscount,
                grossCancelledBefore: sumGrossCancelled(order.items),
                netCancelledBefore: order.cancelledAmount,
                grossCancelledNow,
            });

        await cancelOrderItems(tx, {
            orderId,
            items: activeItems,
            reason: options.reason,
            idempotencyKey: options.idempotencyKey,
        });

        await tx.order.update({
            where: { id: orderId },
            data: {
                cancelledAmount: {
                    increment: netCancellationAmount,
                },
            },
        });
    }

    await releaseCouponClaimForOrder(tx, orderId);

    return true;
}
