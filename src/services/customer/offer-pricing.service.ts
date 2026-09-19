import prisma from "../../config/prisma"
import { Prisma } from "../../../generated/prisma/client";

export interface EffectiveOffer {
  discountPercentage: number;
  source: "PRODUCT" | "CATEGORY";
}

const round2 = (n: number) => Math.round(n * 100) / 100;


export const getEffectiveOffersForProducts = async (
  products: Array<{ id: number; categoryId: number }>
): Promise<Map<number, EffectiveOffer | null>> => {
  const result = new Map<number, EffectiveOffer | null>();

  if (products.length === 0) {
    return result;
  }

  const now = new Date();
  const productIds = products.map((p) => p.id);
  const categoryIds = [...new Set(products.map((p) => p.categoryId))];

  const offers = await prisma.offer.findMany({
    where: {
      isActive: true,
      startsOn: { lte: now },
      expiresOn: { gte: now },
      OR: [
        { type: "PRODUCT", productId: { in: productIds } },
        { type: "CATEGORY", categoryId: { in: categoryIds } },
      ],
    },
    select: {
      type: true,
      productId: true,
      categoryId: true,
      discountPercentage: true,
    },
  });

  const productOfferPct = new Map<number, number>();
  const categoryOfferPct = new Map<number, number>();

  for (const offer of offers) {
    if (offer.type === "PRODUCT" && offer.productId !== null) {
      productOfferPct.set(offer.productId, Number(offer.discountPercentage));
    } else if (offer.type === "CATEGORY" && offer.categoryId !== null) {
      categoryOfferPct.set(offer.categoryId, Number(offer.discountPercentage));
    }
  }

  for (const product of products) {
    const productPct = productOfferPct.get(product.id) ?? null;
    const categoryPct = categoryOfferPct.get(product.categoryId) ?? null;

    if (productPct === null && categoryPct === null) {
      result.set(product.id, null);
      continue;
    }

    if (productPct !== null && (categoryPct === null || productPct >= categoryPct)) {
      result.set(product.id, { discountPercentage: productPct, source: "PRODUCT" });
    } else {
      result.set(product.id, { discountPercentage: categoryPct!, source: "CATEGORY" });
    }
  }

  return result;
};


export const getEffectivePricesForVariants = async (
  variants: Array<{
  id: number;
  price: Prisma.Decimal;
  productId: number;
  categoryId: number;
}>
) => {
  if (variants.length === 0) {
    return new Map();
  }

  const products = [
    ...new Map(
      variants.map((variant) => [
        variant.productId,
        {
          id: variant.productId,
          categoryId: variant.categoryId,
        },
      ])
    ).values(),
  ];

  const offerMap = await getEffectiveOffersForProducts(products);

  const result = new Map<
    number,
    {
      originalPrice: number;
      finalPrice: number;
      discountPercentage: number | null;
      offerSource: "PRODUCT" | "CATEGORY" | null;
    }
  >();

  for (const variant of variants) {
    const originalPrice = Number(variant.price);
    const offer = offerMap.get(variant.productId) ?? null;

    if (!offer) {
      result.set(variant.id, {
        originalPrice,
        finalPrice: originalPrice,
        discountPercentage: null,
        offerSource: null,
      });

      continue;
    }

    const finalPrice = round2(
      originalPrice *
        (1 - offer.discountPercentage / 100)
    );

    result.set(variant.id, {
      originalPrice,
      finalPrice,
      discountPercentage: offer.discountPercentage,
      offerSource: offer.source,
    });
  }

  return result;
};

interface PriceCarrierVariant {
  id: number;
  price: number | string;
  [key: string]: unknown;
}

interface PriceCarrierColor {
  variants: PriceCarrierVariant[];
  [key: string]: unknown;
}

interface PriceCarrier {
  id: number;
  categoryId: number;
  colors: PriceCarrierColor[];
  [key: string]: unknown;
}


export const withEffectivePricing = async <T extends PriceCarrier>(
  products: T[]
): Promise<T[]> => {
  const offerMap = await getEffectiveOffersForProducts(
    products.map((p) => ({ id: p.id, categoryId: p.categoryId }))
  );

  return products.map((product) => {
    const offer = offerMap.get(product.id) ?? null;

    return {
      ...product,
      colors: product.colors.map((color) => ({
        ...color,
        variants: color.variants.map((variant) => {
          const originalPrice = Number(variant.price);

          if (!offer) {
            return {
              ...variant,
              originalPrice,
              finalPrice: originalPrice,
              discountPercentage: null,
              offerSource: null,
            };
          }

          const finalPrice = round2(
            originalPrice * (1 - offer.discountPercentage / 100)
          );

          return {
            ...variant,
            originalPrice,
            finalPrice,
            discountPercentage: offer.discountPercentage,
            offerSource: offer.source,
          };
        }),
      })),
    };
  });
};