import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { Prisma } from "../../../generated/prisma/client";
import { withTransactionRetry } from "../../utils/transaction-retry.util";

const CART_ITEM_INCLUDE = {
  productVariant: {
    include: {
      size: true,
      productColor: {
        include: {
          color: true,
          product: true,
          images: {
            orderBy: { sortOrder: "asc" as const },
          },
        },
      },
    },
  },
} as const;

const isWriteConflict = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code: unknown }).code === "P2034";

export const syncCartPriceSnapshots = async (
  userId: number
): Promise<number> => {
  return prisma.$executeRaw`
    UPDATE "CartItem" AS ci
    SET "priceSnapshot" = pv."price",
        "updatedAt" = NOW()
    FROM "ProductVariant" AS pv, "Cart" AS c
    WHERE ci."cartId" = c."id"
      AND c."userId" = ${userId}
      AND ci."productVariantId" = pv."id"
      AND ci."priceSnapshot" <> pv."price"
  `;
};

export const addToCart = async (
  userId: number,
  productVariantId: number,
  quantity: number
) => {
  try {
    return await withTransactionRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const variant =
            await tx.productVariant.findUnique({
              where: { id: productVariantId },
              select: {
                id: true,
                price: true,
                stock: true,
              },
            });

          if (!variant) {
            throw new AppError(
              "Product variant not found",
              404
            );
          }

          const cart = await tx.cart.upsert({
            where: { userId },
            create: { userId },
            update: {},
          });

          const existingItem =
            await tx.cartItem.findUnique({
              where: {
                cartId_productVariantId: {
                  cartId: cart.id,
                  productVariantId,
                },
              },
              select: { quantity: true },
            });

          const projectedQuantity =
            (existingItem?.quantity ?? 0) + quantity;

          if (projectedQuantity > variant.stock) {
            throw new AppError(
              "Insufficient stock",
              409
            );
          }

          return tx.cartItem.upsert({
            where: {
              cartId_productVariantId: {
                cartId: cart.id,
                productVariantId,
              },
            },
            create: {
              cartId: cart.id,
              productVariantId,
              quantity: projectedQuantity,
              priceSnapshot: variant.price,
            },
            update: {
              quantity: projectedQuantity,
              priceSnapshot: variant.price,
            },
          });
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5000,
          timeout: 10000,
        }
      )
    );
  } catch (err) {
    if (isWriteConflict(err)) {
      throw new AppError(
        "Cart was updated at the same time. Please try again.",
        409
      );
    }

    throw err;
  }
};

export const getCart = async (userId: number) => {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: CART_ITEM_INCLUDE,
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!cart) {
    return {
      id: null,
      items: [],
      itemCount: 0,
      subtotal: new Prisma.Decimal(0).toFixed(2),
      hasPriceChanges: false,
    };
  }

  let subtotal = new Prisma.Decimal(0);

  let hasPriceChanges = false;

  const items = cart.items.map((item) => {
    const currentPrice = item.productVariant.price;

    const lineTotal = currentPrice.mul(
      item.quantity
    );

    const priceChanged = !item.priceSnapshot.equals(
      currentPrice
    );

    if (priceChanged) {
      hasPriceChanges = true;
    }

    subtotal = subtotal.add(lineTotal);

    return {
      ...item,
      lineTotal: lineTotal.toFixed(2),
      priceChanged,
    };
  });

  if (hasPriceChanges) {
    await syncCartPriceSnapshots(userId);
  }

  return {
    ...cart,
    items,
    itemCount: items.reduce(
      (count, item) => count + item.quantity,
      0
    ),
    subtotal: subtotal.toFixed(2),
    hasPriceChanges,
  };
};

export const updateCartItem = async (
  userId: number,
  cartItemId: number,
  quantity: number
) => {
  try {
    return await withTransactionRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const item = await tx.cartItem.findUnique({
            where: { id: cartItemId },
            include: {
              cart: true,
              productVariant: true,
            },
          });

          if (!item || item.cart.userId !== userId) {
            throw new AppError(
              "Cart item not found",
              404
            );
          }

          if (
            quantity > item.productVariant.stock
          ) {
            throw new AppError(
              "Insufficient stock",
              409
            );
          }

          return tx.cartItem.update({
            where: { id: cartItemId },
            data: {
              quantity,
              priceSnapshot:
                item.productVariant.price,
            },
            include: CART_ITEM_INCLUDE,
          });
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5000,
          timeout: 10000,
        }
      )
    );
  } catch (err) {
    if (isWriteConflict(err)) {
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
