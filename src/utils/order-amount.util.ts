import { Prisma } from "../../generated/prisma/client";

const ZERO = new Prisma.Decimal(0);

export function calculateCancellationAmounts(params: {
    subtotal: Prisma.Decimal;
    couponDiscount: Prisma.Decimal | null;
    grossCancelledBefore: Prisma.Decimal;
    netCancelledBefore: Prisma.Decimal;
    grossCancelledNow: Prisma.Decimal;
}): {
    couponDiscountPortion: Prisma.Decimal;
    netCancellationAmount: Prisma.Decimal;
} {
    const {
        subtotal,
        couponDiscount,
        grossCancelledBefore,
        netCancelledBefore,
        grossCancelledNow,
    } = params;

    const discount = couponDiscount ?? ZERO;

    if (
        discount.lte(0) ||
        subtotal.lte(0) ||
        grossCancelledNow.lte(0)
    ) {
        return {
            couponDiscountPortion: ZERO,

            netCancellationAmount:
                grossCancelledNow,
        };
    }

    const grossCancelledAfter =
        grossCancelledBefore.add(
            grossCancelledNow
        );

    const discountAllocatedBefore =
        grossCancelledBefore.sub(
            netCancelledBefore
        );

    const discountAllocatedAfter =
        grossCancelledAfter.gte(subtotal)
            ? discount
            : Prisma.Decimal.min(
                  discount
                      .mul(grossCancelledAfter)
                      .div(subtotal)
                      .toDecimalPlaces(2),
                  discount
              );

    const couponDiscountPortion =
        Prisma.Decimal.max(
            discountAllocatedAfter.sub(
                discountAllocatedBefore
            ),
            ZERO
        );

    return {
        couponDiscountPortion,

        netCancellationAmount:
            grossCancelledNow.sub(
                couponDiscountPortion
            ),
    };
}

/**
 * What the customer is owed back on a paid order: the net value of
 * cancelled units plus returned-and-received units, never more than what
 * was charged. Order.refundedAmount is compared against this; the
 * difference is what a refund may claim.
 */
export function refundableAmount(order: {
    total: Prisma.Decimal;
    cancelledAmount: Prisma.Decimal;
    returnedAmount: Prisma.Decimal;
}): Prisma.Decimal {
    return Prisma.Decimal.min(
        order.cancelledAmount.add(order.returnedAmount),
        order.total
    );
}

/** Σ price × (cancelled + returned) — the gross value removed so far. */
export function sumGrossRemoved(
    items: Array<{
        price: Prisma.Decimal;
        cancelledQuantity: number;
        returnedQuantity: number;
    }>
): Prisma.Decimal {
    return items.reduce(
        (sum, item) =>
            sum.add(
                item.price.mul(
                    item.cancelledQuantity + item.returnedQuantity
                )
            ),
        ZERO
    );
}

export function sumGrossCancelled(
    items: Array<{
        price: Prisma.Decimal;
        cancelledQuantity: number;
    }>
): Prisma.Decimal {
    return items.reduce(
        (sum, item) =>
            sum.add(
                item.price.mul(
                    item.cancelledQuantity
                )
            ),
        ZERO
    );
}
