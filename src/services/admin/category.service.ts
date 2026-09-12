import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import {
  CATALOG_NAMESPACE,
  CATALOG_TTL_SECONDS,
  cached,
  invalidateNamespace,
} from "../../utils/cache.util";

interface CreateCategoryInput {
  name: string;
  slug: string;
  description?: string;
  isActive?: boolean;
}

interface UpdateCategoryInput {
  name?: string;
  slug?: string;
  description?: string;
  isActive?: boolean;
}

export const createCategory = async (
  data: CreateCategoryInput
) => {
  const existingCategory =
    await prisma.category.findFirst({
      where: {
        OR: [
          { name: data.name },
          { slug: data.slug },
        ],
      },
    });

  if (existingCategory) {
    throw new AppError(
      "Category name or slug already exists",
      409
    );
  }

  const category = await prisma.category.create({
    data: {
      name: data.name,
      slug: data.slug,
      description: data.description,
      isActive: data.isActive ?? true,
    },
  });

  await invalidateNamespace(CATALOG_NAMESPACE);

  return category;
};

export const listCategories = async () => {
  return cached(
    CATALOG_NAMESPACE,
    "categories:list",
    CATALOG_TTL_SECONDS,
    () =>
      prisma.category.findMany({
        orderBy: {
          createdAt: "desc",
        },
      })
  );
};

export const getCategoryById = async (
  id: number
) => {
  const category =
    await prisma.category.findUnique({
      where: { id },
    });

  if (!category) {
    throw new AppError(
      "Category not found",
      404
    );
  }

  return category;
};

export const updateCategory = async (
  id: number,
  data: UpdateCategoryInput
) => {
  const category =
    await prisma.category.findUnique({
      where: { id },
    });

  if (!category) {
    throw new AppError(
      "Category not found",
      404
    );
  }

  if (data.name || data.slug) {
    const duplicate =
      await prisma.category.findFirst({
        where: {
          OR: [
            ...(data.name
              ? [{ name: data.name }]
              : []),
            ...(data.slug
              ? [{ slug: data.slug }]
              : []),
          ],
          NOT: {
            id,
          },
        },
      });

    if (duplicate) {
      throw new AppError(
        "Category name or slug already exists",
        409
      );
    }
  }

  const updated = await prisma.category.update({
    where: { id },
    data,
  });

  await invalidateNamespace(CATALOG_NAMESPACE);

  return updated;
};


export const blockCategory = async (
  id: number
) => {
  const category =
    await prisma.category.findUnique({
      where: { id },
    });

  if (!category) {
    throw new AppError(
      "Category not found",
      404
    );
  }

  if (!category.isActive) {
    throw new AppError(
      "Category is already blocked",
      400
    );
  }

  const blocked = await prisma.category.update({
    where: { id },
    data: {
      isActive: false,
    },
  });

  await invalidateNamespace(CATALOG_NAMESPACE);

  return blocked;
};


export const unblockCategory = async (
  id: number
) => {
  const category =
    await prisma.category.findUnique({
      where: { id },
    });

  if (!category) {
    throw new AppError(
      "Category not found",
      404
    );
  }

  if (category.isActive) {
    throw new AppError(
      "Category is already active",
      400
    );
  }

  const unblocked = await prisma.category.update({
    where: { id },
    data: {
      isActive: true,
    },
  });

  await invalidateNamespace(CATALOG_NAMESPACE);

  return unblocked;
};


export const deleteCategory = async (
  id: number
) => {
  const category =
    await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

  if (!category) {
    throw new AppError(
      "Category not found",
      404
    );
  }

  if (category._count.products > 0) {
    throw new AppError(
      "Cannot delete a category that has products",
      409
    );
  }

  await prisma.category.delete({
    where: { id },
  });

  await invalidateNamespace(CATALOG_NAMESPACE);
};
