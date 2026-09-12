import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { deleteImageFromStorage } from "./image.service";
import { ListProductsQuery } from "../../validations/product.validation";

export type ProductImageInput =
  | {
      url: string;
      publicId: string;
      altText?: string;
      sortOrder?: number;
      isPrimary?: boolean;
    }
  | {
      existing: true;
      id: number;
      altText?: string;
      sortOrder?: number;
      isPrimary?: boolean;
    };

export interface ProductVariantInput {
  sizeId: number;
  price: number;
  stock: number;
}

export interface ProductColorInput {
  colorId: number;
  images: ProductImageInput[];
  variants: ProductVariantInput[];
}

export interface CreateProductInput {
  name: string;
  slug: string;
  description?: string;
  details?: string;
  categoryId: number;
  isActive?: boolean;
  colors: ProductColorInput[];
}

export interface UpdateProductInput {
  name?: string;
  slug?: string;
  description?: string;
  details?: string;
  categoryId?: number;
  isActive?: boolean;
  colors?: ProductColorInput[];
  removedColorIds?: number[];
}

interface ResolvedProductImage {
  url: string;
  publicId: string;
  altText?: string;
  sortOrder?: number;
  isPrimary?: boolean;
}

interface ResolvedProductColor {
  colorId: number;
  images: ResolvedProductImage[];
  variants: ProductVariantInput[];
}

const isExistingImage = (
  image: ProductImageInput,
): image is Extract<ProductImageInput, { existing: true }> =>
  "existing" in image && image.existing === true;

const assertAllImagesAreNew = (
  colors: ProductColorInput[],
): ResolvedProductColor[] => {
  return colors.map((color) => ({
    colorId: color.colorId,
    variants: color.variants,
    images: color.images.map((image): ResolvedProductImage => {
      if (isExistingImage(image)) {
        throw new AppError(
          "New products cannot reference existing images",
          400,
        );
      }

      return {
        url: image.url,
        publicId: image.publicId,
        altText: image.altText,
        sortOrder: image.sortOrder,
        isPrimary: image.isPrimary,
      };
    }),
  }));
};

const productInclude = {
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

        orderBy: {
          size: {
            sortOrder: "asc" as const,
          },
        },
      },
    },
  },
};

export const validateCategory = async (categoryId: number) => {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
  });

  if (!category) {
    throw new AppError("Category not found", 404);
  }

  if (!category.isActive) {
    throw new AppError("Category is blocked", 409);
  }

  return category;
};

const validateProductOptions = async (colors: ResolvedProductColor[]) => {
  if (colors.length === 0) {
    throw new AppError("At least one color is required", 400);
  }

  const colorIds = colors.map((color) => color.colorId);
  const uniqueColorIds = new Set(colorIds);

  if (uniqueColorIds.size !== colorIds.length) {
    throw new AppError("Duplicate colors are not allowed", 400);
  }

  const existingColors = await prisma.color.findMany({
    where: { id: { in: [...uniqueColorIds] } },
    select: { id: true },
  });

  if (existingColors.length !== uniqueColorIds.size) {
    throw new AppError("One or more colors were not found", 404);
  }

  const sizeIds = colors.flatMap((color) =>
    color.variants.map((variant) => variant.sizeId),
  );

  if (sizeIds.length === 0) {
    throw new AppError("At least one size variant is required", 400);
  }

  const uniqueSizeIds = new Set(sizeIds);

  const existingSizes = await prisma.size.findMany({
    where: { id: { in: [...uniqueSizeIds] } },
    select: { id: true },
  });

  if (existingSizes.length !== uniqueSizeIds.size) {
    throw new AppError("One or more sizes were not found", 404);
  }

  for (const color of colors) {
    if (color.images.length === 0) {
      throw new AppError("Each color must have at least one image", 400);
    }

    if (color.variants.length === 0) {
      throw new AppError("Each color must have at least one size variant", 400);
    }

    for (const image of color.images) {
      if (!image.url.trim()) {
        throw new AppError("Image URL is required", 400);
      }

      if (!image.publicId.trim()) {
        throw new AppError("Image public ID is required", 400);
      }

      if (image.sortOrder !== undefined && image.sortOrder < 0) {
        throw new AppError("Image sort order cannot be negative", 400);
      }
    }

    const primaryImages = color.images.filter(
      (image) => image.isPrimary === true,
    );

    if (primaryImages.length !== 1) {
      throw new AppError("Each color must have exactly one primary image", 400);
    }

    const variantSizeIds = color.variants.map((variant) => variant.sizeId);
    const uniqueVariantSizeIds = new Set(variantSizeIds);

    if (uniqueVariantSizeIds.size !== variantSizeIds.length) {
      throw new AppError(
        "Duplicate sizes are not allowed for the same color",
        400,
      );
    }

    for (const variant of color.variants) {
      if (variant.price <= 0) {
        throw new AppError("Variant price must be greater than 0", 400);
      }

      if (variant.stock < 0) {
        throw new AppError("Variant stock cannot be negative", 400);
      }
    }
  }
};

export const validateProductUniqueness = async (
  name?: string,
  slug?: string,
  excludeId?: number,
) => {
  if (name === undefined && slug === undefined) {
    return;
  }

  const conditions: Array<{ name: string } | { slug: string }> = [];

  if (name !== undefined) {
    conditions.push({ name });
  }

  if (slug !== undefined) {
    conditions.push({ slug });
  }

  const duplicate = await prisma.product.findFirst({
    where: {
      OR: conditions,
      ...(excludeId !== undefined && { NOT: { id: excludeId } }),
    },
    select: { id: true, name: true, slug: true },
  });

  if (!duplicate) {
    return;
  }

  if (slug !== undefined && duplicate.slug === slug) {
    throw new AppError("Product slug already exists", 409);
  }

  if (name !== undefined && duplicate.name === name) {
    throw new AppError("Product name already exists", 409);
  }

  throw new AppError("Product name or slug already exists", 409);
};

const isUniqueConstraintError = (
  error: unknown,
): error is { code: "P2002"; meta?: { target?: string[] } } =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "P2002";

const rethrowAsUniquenessError = (error: unknown): never => {
  if (isUniqueConstraintError(error)) {
    const target = error.meta?.target ?? [];

    if (target.includes("slug")) {
      throw new AppError("Product slug already exists", 409);
    }

    if (target.includes("name")) {
      throw new AppError("Product name already exists", 409);
    }

    throw new AppError("Product name or slug already exists", 409);
  }

  throw error;
};

const resolveColorsForUpdate = (
  existingProduct: {
    colors: Array<{
      images: Array<{
        id: number;
        publicId: string;
        url: string;
      }>;
    }>;
  },
  colors: ProductColorInput[],
): ResolvedProductColor[] => {
  const existingImageMap = new Map<number, { url: string; publicId: string }>();

  for (const productColor of existingProduct.colors) {
    for (const image of productColor.images) {
      existingImageMap.set(image.id, {
        url: image.url,
        publicId: image.publicId,
      });
    }
  }

  return colors.map((color) => ({
    colorId: color.colorId,
    variants: color.variants,

    images: color.images.map((image): ResolvedProductImage => {
      if (isExistingImage(image)) {
        const found = existingImageMap.get(image.id);

        if (!found) {
          throw new AppError(
            "One or more existing images were not found on this product",
            404,
          );
        }

        return {
          url: found.url,
          publicId: found.publicId,
          altText: image.altText,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
        };
      }

      return {
        url: image.url,
        publicId: image.publicId,
        altText: image.altText,
        sortOrder: image.sortOrder,
        isPrimary: image.isPrimary,
      };
    }),
  }));
};

const deleteImagesIfUnreferenced = async (publicIds: string[]) => {
  if (publicIds.length === 0) {
    return;
  }

  const uniquePublicIds = [...new Set(publicIds)];

  const stillReferenced = await prisma.productImage.findMany({
    where: { publicId: { in: uniquePublicIds } },
    select: { publicId: true },
    distinct: ["publicId"],
  });

  const stillReferencedSet = new Set(
    stillReferenced.map((row) => row.publicId),
  );

  const safeToDelete = uniquePublicIds.filter(
    (publicId) => !stillReferencedSet.has(publicId),
  );

  if (safeToDelete.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    safeToDelete.map((publicId) => deleteImageFromStorage(publicId)),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `Failed to delete Cloudinary image ${safeToDelete[index]}:`,
        result.reason,
      );
    }
  });
};

type TransactionClient = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

const insertColors = async (
  tx: Pick<
    TransactionClient,
    "productColor" | "productImage" | "productVariant"
  >,
  productId: number,
  colors: ResolvedProductColor[],
) => {
  if (colors.length === 0) {
    return;
  }

  const createdColors = await tx.productColor.createManyAndReturn({
    data: colors.map((color) => ({
      productId,
      colorId: color.colorId,
    })),
    select: { id: true, colorId: true },
  });

  const productColorIdByColorId = new Map(
    createdColors.map((row) => [row.colorId, row.id]),
  );

  await tx.productImage.createMany({
    data: colors.flatMap((color) =>
      color.images.map((image) => ({
        productColorId: productColorIdByColorId.get(color.colorId)!,
        url: image.url,
        publicId: image.publicId,
        altText: image.altText || null,
        sortOrder: image.sortOrder ?? 0,
        isPrimary: image.isPrimary ?? false,
      })),
    ),
  });

  await tx.productVariant.createMany({
    data: colors.flatMap((color) =>
      color.variants.map((variant) => ({
        productColorId: productColorIdByColorId.get(color.colorId)!,
        sizeId: variant.sizeId,
        price: variant.price,
        stock: variant.stock,
      })),
    ),
  });
};

export const createProduct = async (data: CreateProductInput) => {
  await validateCategory(data.categoryId);

  const resolvedColors = assertAllImagesAreNew(data.colors);

  await validateProductOptions(resolvedColors);

  await validateProductUniqueness(data.name, data.slug);

  try {
    return await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: data.name,
          slug: data.slug,
          description: data.description || null,
          details: data.details || null,
          categoryId: data.categoryId,
          isActive: data.isActive ?? true,
        },
      });

      await insertColors(tx, product.id, resolvedColors);

      return tx.product.findUnique({
        where: { id: product.id },
        include: productInclude,
      });
    });
  } catch (error) {
    rethrowAsUniquenessError(error);
  }
};

export const listProducts = async (
  query: ListProductsQuery
) => {
  const { page, limit } = query;

  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      include: productInclude,
      skip: (page - 1) * limit,
      take: limit,
    }),

    prisma.product.count(),
  ]);

  const totalPages = Math.max(Math.ceil(total / limit), 1);

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

export const getProductById = async (id: number) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: productInclude,
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  return product;
};

export const updateProduct = async (id: number, data: UpdateProductInput) => {
  const existingProduct = await prisma.product.findUnique({
    where: { id },
    include: {
      colors: {
        include: {
          images: true,
        },
      },
    },
  });

  if (!existingProduct) {
    throw new AppError("Product not found", 404);
  }

  const removedColorIds = data.removedColorIds ?? [];

  if (
    data.name === undefined &&
    data.slug === undefined &&
    data.description === undefined &&
    data.details === undefined &&
    data.categoryId === undefined &&
    data.isActive === undefined &&
    data.colors === undefined &&
    removedColorIds.length === 0
  ) {
    throw new AppError("No fields provided for update", 400);
  }

  if (data.colors !== undefined && removedColorIds.length > 0) {
    const patchedIds = new Set(data.colors.map((c) => c.colorId));

    const conflict = removedColorIds.some((colorId) => patchedIds.has(colorId));

    if (conflict) {
      throw new AppError(
        "A color cannot be both updated and removed in the same request",
        400,
      );
    }
  }

  if (removedColorIds.length > 0) {
    const existingColorIdsOnProduct = new Set(
      existingProduct.colors.map((c) => c.colorId),
    );

    const invalid = removedColorIds.filter(
      (colorId) => !existingColorIdsOnProduct.has(colorId),
    );

    if (invalid.length > 0) {
      throw new AppError(
        "One or more colors to remove were not found on this product",
        404,
      );
    }
  }

  if (data.categoryId !== undefined) {
    await validateCategory(data.categoryId);
  }

  let resolvedColors: ResolvedProductColor[] | undefined;

  if (data.colors !== undefined) {
    resolvedColors = resolveColorsForUpdate(existingProduct, data.colors);

    await validateProductOptions(resolvedColors);
  }

  await validateProductUniqueness(data.name, data.slug, id);

  const patchedColorIds = new Set((resolvedColors ?? []).map((c) => c.colorId));
  const removedColorIdSet = new Set(removedColorIds);

  const remainingColorCount = existingProduct.colors.filter(
    (color) =>
      !removedColorIdSet.has(color.colorId) ||
      patchedColorIds.has(color.colorId),
  ).length;

  const wouldHaveAnyColor = remainingColorCount > 0 || patchedColorIds.size > 0;

  if (!wouldHaveAnyColor) {
    throw new AppError("A product must have at least one color", 400);
  }

  const touchedColorIds = new Set([...patchedColorIds, ...removedColorIdSet]);

  const oldImagesFromTouchedColors = existingProduct.colors
    .filter((color) => touchedColorIds.has(color.colorId))
    .flatMap((color) => color.images);

  const oldPublicIds = new Set(
    oldImagesFromTouchedColors.map((image) => image.publicId),
  );

  const newPublicIds =
    resolvedColors === undefined
      ? new Set<string>()
      : new Set(
          resolvedColors.flatMap((color) =>
            color.images.map((image) => image.publicId),
          ),
        );

  const candidatePublicIds = [...oldPublicIds].filter(
    (publicId) => !newPublicIds.has(publicId),
  );

  let result;

  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.slug !== undefined && { slug: data.slug }),
          ...(data.description !== undefined && {
            description: data.description || null,
          }),
          ...(data.details !== undefined && {
            details: data.details || null,
          }),
          ...(data.categoryId !== undefined && {
            categoryId: data.categoryId,
          }),
          ...(data.isActive !== undefined && {
            isActive: data.isActive,
          }),
        },
      });

      /*
       * Explicit removals first.
       */
      if (removedColorIds.length > 0) {
        await tx.productColor.deleteMany({
          where: {
            productId: id,
            colorId: { in: removedColorIds },
          },
        });
      }

      if (resolvedColors !== undefined) {
        const incomingColorIds = resolvedColors.map((color) => color.colorId);

        await tx.productColor.deleteMany({
          where: {
            productId: id,
            colorId: { in: incomingColorIds },
          },
        });

        await insertColors(tx, id, resolvedColors);
      }

      return tx.product.findUnique({
        where: { id },
        include: productInclude,
      });
    });
  } catch (error) {
    rethrowAsUniquenessError(error);
  }

  await deleteImagesIfUnreferenced(candidatePublicIds);

  return result;
};

export const deleteProduct = async (id: number) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      colors: {
        include: {
          images: true,
        },
      },
    },
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  const publicIds = product.colors.flatMap((productColor) =>
    productColor.images.map((image) => image.publicId),
  );

  await prisma.product.delete({
    where: { id },
  });

  await deleteImagesIfUnreferenced(publicIds);
};
