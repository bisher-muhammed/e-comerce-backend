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
