import { Prisma } from "../../generated/prisma/client";

export function calculateCouponDiscountPortion(
    orderSubtotal: Prisma.Decimal,
    orderCouponDiscount: Prisma.Decimal | null,
    cancellationAmount: Prisma.Decimal
): Prisma.Decimal {
    if (
        !orderCouponDiscount ||
        orderCouponDiscount.lte(0) ||
        orderSubtotal.lte(0) ||
        cancellationAmount.lte(0)
    ) {
        return new Prisma.Decimal(0);
    }

    const portion = orderCouponDiscount
        .mul(cancellationAmount)
        .div(orderSubtotal)
        .toDecimalPlaces(2);

    // Never give back more discount than the order actually carries.
    return Prisma.Decimal.min(
        portion,
        orderCouponDiscount
    );
}
