import prisma from "../../config/prisma";

import { Prisma } from "../../../generated/prisma/client";

import { ListProductsQuery } from "../../validations/customer/product.validation";

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

  const [products, total] =
    await prisma.$transaction([
      prisma.product.findMany({
        where,

        include: {
          category: true,

          colors: {
            include: {
              color: true,

              images: {
                orderBy: {
                  sortOrder: "asc",
                },
              },

              variants: {
                include: {
                  size: true,
                },
              },
            },
          },
        },

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

  const totalPages = Math.max(
    Math.ceil(total / limit),
    1
  );

  return {
    products,

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
  return prisma.product.findFirst({
    where: {
      slug,
      isActive: true,
    },
    include: {
      category: true,
      colors: {
        include: {
          color: true,
          images: {
            orderBy: {
              sortOrder: "asc",
            },
          },
          variants: {
            include: {
              size: true,
            },
          },
        },
      },
    },
  });
};

