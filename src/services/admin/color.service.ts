import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

interface CreateColorInput {
  name: string;
  slug: string;
  hexCode?: string;
}

interface UpdateColorInput {
  name?: string;
  slug?: string;
  hexCode?: string;
}

export const createColor = async (
  data: CreateColorInput
) => {
  const name = data.name.trim().toUpperCase();
  const slug = data.slug.trim().toLowerCase();
  const hexCode = data.hexCode?.trim();

  // Check name
  const existingName = await prisma.color.findFirst({
    where: {
      name,
    },
  });

  if (existingName) {
    throw new AppError(
      "Color name already exists",
      409
    );
  }

 
  const existingSlug = await prisma.color.findFirst({
    where: {
      slug,
    },
  });

  if (existingSlug) {
    throw new AppError(
      "Color slug already exists",
      409
    );
  }

  return prisma.color.create({
    data: {
      name,
      slug,
      hexCode,
    },
  });
};

export const listColors = async () => {
  return prisma.color.findMany({
    orderBy: {
      name: "asc",
    },
  });
};

export const getColorById = async (
  id: number
) => {
  const color = await prisma.color.findUnique({
    where: {
      id,
    },
  });

  if (!color) {
    throw new AppError(
      "Color not found",
      404
    );
  }

  return color;
};

export const updateColor = async (
  id: number,
  data: UpdateColorInput
) => {
  const color = await prisma.color.findUnique({
    where: {
      id,
    },
  });

  if (!color) {
    throw new AppError(
      "Color not found",
      404
    );
  }

  const updateData: UpdateColorInput = {};

  // Normalize name
  if (data.name !== undefined) {
    const name = data.name
      .trim()
      .toUpperCase();

    const duplicateName =
      await prisma.color.findFirst({
        where: {
          name,
          NOT: {
            id,
          },
        },
      });

    if (duplicateName) {
      throw new AppError(
        "Color name already exists",
        409
      );
    }

    updateData.name = name;
  }

  if (data.slug !== undefined) {
    const slug = data.slug
      .trim()
      .toLowerCase();

    const duplicateSlug =
      await prisma.color.findFirst({
        where: {
          slug,
          NOT: {
            id,
          },
        },
      });

    if (duplicateSlug) {
      throw new AppError(
        "Color slug already exists",
        409
      );
    }

    updateData.slug = slug;
  }

  
  if (data.hexCode !== undefined) {
    updateData.hexCode =
      data.hexCode.trim();
  }

  return prisma.color.update({
    where: {
      id,
    },
    data: updateData,
  });
};

export const deleteColor = async (
  id: number
) => {
  const color = await prisma.color.findUnique({
    where: {
      id,
    },
    include: {
      _count: {
        select: {
          products: true,
        },
      },
    },
  });

  if (!color) {
    throw new AppError(
      "Color not found",
      404
    );
  }

  if (color._count.products > 0) {
    throw new AppError(
      "Cannot delete a color that is used by products",
      409
    );
  }

  await prisma.color.delete({
    where: {
      id,
    },
  });
};
