import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

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

  return prisma.category.create({
    data: {
      name: data.name,
      slug: data.slug,
      description: data.description,
      isActive: data.isActive ?? true,
    },
  });
};

export const listCategories = async () => {
  return prisma.category.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });
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

  return prisma.category.update({
    where: { id },
    data,
  });
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

  return prisma.category.update({
    where: { id },
    data: {
      isActive: false,
    },
  });
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

  return prisma.category.update({
    where: { id },
    data: {
      isActive: true,
    },
  });
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
};
