import prisma from "../../config/prisma";

export const getProducts = async () => {
  return prisma.product.findMany({
    where: {
      isActive: true,
      category: {
        isActive: true,
      },
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

    orderBy: {
      createdAt: "desc",
    },
  });
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

