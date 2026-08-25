import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

export const addToCart = async (
  userId: number,
  productVariantId: number,
  quantity: number
) => {
  const variant = await prisma.productVariant.findUnique({
    where: { id: productVariantId },
  });

  if (!variant) {
    throw new AppError("Product variant not found", 404);
  }
 




  const cart = await prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

   const existingItem = await prisma.cartItem.findUnique({
    where: {
      cartId_productVariantId: {
        cartId: cart.id,
        productVariantId,
      },
    },
  });

  const projectedQuantity = (existingItem?.quantity ?? 0) + quantity;

  if (projectedQuantity > variant.stock) {
    throw new AppError("Insufficient stock", 409);
  }

  return prisma.cartItem.upsert({
    where: {
      cartId_productVariantId: {
        cartId: cart.id,
        productVariantId,
      },
    },
    create: {
      cartId: cart.id,
      productVariantId,
      quantity,
    },
    update: {
      quantity: { increment: quantity },
    },
  });
};

export const getCart = async (userId: number) => {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          productVariant: {
            include: {
              size: true,
              productColor: {
                include: {
                  color: true,
                  product: true,
                  images: {
                    orderBy: { sortOrder: "asc" },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  // Return an empty cart shape rather than null so the frontend
  // doesn't need a separate "no cart yet" branch from "empty cart".
  return cart ?? { id: null, items: [] };
};

export const updateCartItem = async (
  userId: number,
  cartItemId: number,
  quantity: number
) => {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const item = await tx.cartItem.findUnique({
          where: { id: cartItemId },
          include: {
            cart: true,
            productVariant: true,
          },
        });

        if (!item || item.cart.userId !== userId) {
          throw new AppError("Cart item not found", 404);
        }

        if (quantity > item.productVariant.stock) {
          throw new AppError("Insufficient stock", 409);
        }

        return tx.cartItem.update({
          where: { id: cartItemId },
          data: {
            quantity,
          },
          include: {
            productVariant: {
              include: {
                size: true,
                productColor: {
                  include: {
                    color: true,
                    product: true,
                    images: {
                      orderBy: {
                        sortOrder: "asc",
                      },
                    },
                  },
                },
              },
            },
          },
        });
      },
      {
        isolationLevel: "Serializable",
      }
    );
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "P2034"
    ) {
      throw new AppError(
        "Cart was updated at the same time. Please try again.",
        409
      );
    }

    throw err;
  }
};


export const removeCartItem = async (
  userId: number,
  cartItemId: number
) => {
  const item = await prisma.cartItem.findUnique({
    where: { id: cartItemId },
    include: { cart: true },
  });

  if (!item || item.cart.userId !== userId) {
    throw new AppError("Cart item not found", 404);
  }

  try {
    return await prisma.cartItem.delete({
      where: { id: cartItemId },
    });
  } catch (err) {
    // Already deleted by a concurrent request — treat as success,
    // the end state the caller wanted (item gone) is already true.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "P2025"
    ) {
      return null;
    }
    throw err;
  }
};