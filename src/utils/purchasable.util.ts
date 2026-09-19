/*
 * The one "can this be bought" rule (audit M3). A variant is purchasable
 * only when it, its colour, its product and the product's category are
 * all active. Deactivating any of them takes the item off sale everywhere:
 * catalog, cart and checkout.
 */
import AppError from "../errors/AppError";
import type { Prisma } from "../../generated/prisma/client";

export const PURCHASABLE_VARIANT_WHERE = {
  isActive: true,
  productColor: {
    isActive: true,
    product: {
      isActive: true,
      category: { isActive: true },
    },
  },
} satisfies Prisma.ProductVariantWhereInput;

/** Include shape that carries every flag isPurchasable needs. */
export const PURCHASABILITY_INCLUDE = {
  productColor: {
    select: {
      isActive: true,
      product: {
        select: {
          name: true,
          isActive: true,
          category: { select: { isActive: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductVariantInclude;

export interface PurchasabilityFlags {
  isActive: boolean;
  productColor: {
    isActive: boolean;
    product: {
      isActive: boolean;
      category: { isActive: boolean };
    };
  };
}

export const isPurchasable = (variant: PurchasabilityFlags) =>
  variant.isActive &&
  variant.productColor.isActive &&
  variant.productColor.product.isActive &&
  variant.productColor.product.category.isActive;

export const assertPurchasable = (
  variant: PurchasabilityFlags & {
    productColor: { product: { name: string } };
  }
) => {
  if (!isPurchasable(variant)) {
    throw new AppError(
      `${variant.productColor.product.name} is no longer available`,
      409
    );
  }
};
