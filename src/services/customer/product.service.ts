import prisma from "../../config/prisma";

import { Prisma } from "../../../generated/prisma/client";

import { ListProductsQuery } from "../../validations/customer/product.validation";

import {
  CATALOG_NAMESPACE,
  cached,
} from "../../utils/cache.util";

const PRODUCT_CACHE_TTL_SECONDS = 60;

const PRODUCT_INCLUDE = {
  category: true,

  colors: {
    include: {
      color: true,

      images: {
        orderBy: {
          sortOrder: "asc" as const,
        },
      },

      variants: {
        include: {
          size: true,
        },
      },
    },
  },
} as const;

interface StockCarrier {
  colors: Array<{
    variants: Array<{
      id: number;
      stock: number;
    }>;
  }>;
}

const withoutStock = <T extends StockCarrier>(
  product: T
): T =>
  ({
    ...product,

    colors: product.colors.map((color) => ({
      ...color,

      variants: color.variants.map(
        ({ stock, ...variant }) => variant
      ),
    })),
  }) as unknown as T;

const withLiveStock = async <T extends StockCarrier>(
  products: T[]
): Promise<T[]> => {
  const variantIds = products.flatMap((product) =>
    product.colors.flatMap((color) =>
      color.variants.map((variant) => variant.id)
    )
  );

  if (variantIds.length === 0) {
    return products;
  }

  const rows = await prisma.productVariant.findMany({
    where: {
      id: {
        in: variantIds,
      },
    },

    select: {
      id: true,
      stock: true,
    },
  });

  const stockById = new Map(
    rows.map((row) => [row.id, row.stock])
  );

  return products.map((product) => ({
    ...product,

    colors: product.colors.map((color) => ({
      ...color,

      variants: color.variants.map((variant) => ({
        ...variant,

        stock: stockById.get(variant.id) ?? 0,
      })),
    })),
  }));
};

export const getProducts = async (
  query: ListProductsQuery
) => {
  const { page, limit, categoryId } =
    query;

  const where: Prisma.ProductWhereInput = {
    isActive: true,

    category: {
      isActive: true,
    },

    ...(categoryId !== undefined && {
      categoryId,
    }),
  };

  const cacheKey = `products:list:${page}:${limit}:${
    categoryId ?? "all"
  }`;

  const { products, total } = await cached(
    CATALOG_NAMESPACE,
    cacheKey,
    PRODUCT_CACHE_TTL_SECONDS,
    async () => {
      const [rows, count] =
        await prisma.$transaction([
          prisma.product.findMany({
            where,

            include: PRODUCT_INCLUDE,

            orderBy: {
              createdAt: "desc",
            },

            skip: (page - 1) * limit,

            take: limit,
          }),

          prisma.product.count({
            where,
          }),
        ]);

      return {
        products: rows.map(withoutStock),
        total: count,
      };
    }
  );

  const totalPages = Math.max(
    Math.ceil(total / limit),
    1
  );

  return {
    products: await withLiveStock(products),

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

export const getProductBySlug = async (slug: string) => {
  const product = await cached(
    CATALOG_NAMESPACE,
    `products:slug:${slug}`,
    PRODUCT_CACHE_TTL_SECONDS,
    async () => {
      const row = await prisma.product.findFirst({
        where: {
          slug,
          isActive: true,
        },

        include: PRODUCT_INCLUDE,
      });

      return row === null
        ? null
        : withoutStock(row);
    }
  );

  if (product === null) {
    return null;
  }

  const [withStock] = await withLiveStock([
    product,
  ]);

  return withStock;
};
