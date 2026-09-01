import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";


// GET WISHLIST
export const getWishlist = async (userId: number) => {
  return prisma.wishlist.findUnique({
    where: {
      userId,
    },
    include: {
      items: {
        include: {
          product: {
            include: {
              colors: {
                include: {
                  color: true,
                  images: true,
                  variants: {
                    include: {
                      size: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
};


// ADD PRODUCT TO WISHLIST
export const addWishlistItem = async (
  userId: number,
  productId: number
) => {
  // Check product
  const product = await prisma.product.findUnique({
    where: {
      id: productId,
    },
    select: {
      id: true,
      isActive: true,
    },
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  if (!product.isActive) {
    throw new AppError("Product is not available", 404);
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Get or create user's wishlist
        const wishlist = await tx.wishlist.upsert({
          where: {
            userId,
          },
          create: {
            userId,
          },
          update: {},
        });

        // Add product
        const item = await tx.wishlistItem.create({
          data: {
            wishlistId: wishlist.id,
            productId,
          },
          include: {
            product: true,
          },
        });

        return item;
      },
      {
        isolationLevel: "Serializable",
      }
    );

    return result;
  } catch (err) {
    // Same product was added concurrently
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "P2002"
    ) {
      throw new AppError(
        "Product is already in your wishlist.",
        409
      );
    }

    // Concurrent transaction conflict
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "P2034"
    ) {
      throw new AppError(
        "Wishlist was updated at the same time. Please try again.",
        409
      );
    }

    throw err;
  }
};


// REMOVE PRODUCT FROM WISHLIST
export const removeWishlistItem = async (
  userId: number,
  productId: number
) => {
  const wishlist = await prisma.wishlist.findUnique({
    where: {
      userId,
    },
    select: {
      id: true,
    },
  });

  if (!wishlist) {
    throw new AppError("Wishlist not found", 404);
  }

  const item = await prisma.wishlistItem.findUnique({
    where: {
      wishlistId_productId: {
        wishlistId: wishlist.id,
        productId,
      },
    },
    select: {
      id: true,
    },
  });

  if (!item) {
    throw new AppError(
      "Product is not in your wishlist",
      404
    );
  }

  return prisma.wishlistItem.delete({
    where: {
      id: item.id,
    },
  });
};
