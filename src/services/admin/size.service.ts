import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

interface CreateSizeInput {
  name: string;
  sortOrder: number;
}

interface UpdateSizeInput {
  name?: string;
  sortOrder?: number;
}

export const createSize = async (
  data: CreateSizeInput
) => {
  const existingName =
    await prisma.size.findUnique({
      where: {
        name: data.name,
      },
    });

  if (existingName) {
    throw new AppError(
      "Size name already exists",
      409
    );
  }

  const existingOrder =
    await prisma.size.findUnique({
      where: {
        sortOrder: data.sortOrder,
      },
    });

  if (existingOrder) {
    throw new AppError(
      "Sort order already exists",
      409
    );
  }

  return prisma.size.create({
    data: {
      name: data.name,
      sortOrder: data.sortOrder,
    },
  });
};

export const listSizes = async () => {
  return prisma.size.findMany({
    orderBy: {
      sortOrder: "asc",
    },
  });
};

export const getSizeById = async (
  id: number
) => {
  const size = await prisma.size.findUnique({
    where: {
      id,
    },
  });

  if (!size) {
    throw new AppError(
      "Size not found",
      404
    );
  }

  return size;
};

export const updateSize = async (
  id: number,
  data: UpdateSizeInput
) => {
  const size = await prisma.size.findUnique({
    where: {
      id,
    },
  });

  if (!size) {
    throw new AppError(
      "Size not found",
      404
    );
  }

  if (data.name !== undefined) {
    const duplicateName =
      await prisma.size.findFirst({
        where: {
          name: data.name,
          NOT: {
            id,
          },
        },
      });

    if (duplicateName) {
      throw new AppError(
        "Size name already exists",
        409
      );
    }
  }

  if (data.sortOrder !== undefined) {
    const duplicateOrder =
      await prisma.size.findFirst({
        where: {
          sortOrder: data.sortOrder,
          NOT: {
            id,
          },
        },
      });

    if (duplicateOrder) {
      throw new AppError(
        "Sort order already exists",
        409
      );
    }
  }

  return prisma.size.update({
    where: {
      id,
    },
    data,
  });
};

export const deleteSize = async (
  id: number
) => {
  const size = await prisma.size.findUnique({
    where: {
      id,
    },
    include: {
      _count: {
        select: {
          variants: true,
        },
      },
    },
  });

  if (!size) {
    throw new AppError(
      "Size not found",
      404
    );
  }

  if (size._count.variants > 0) {
    throw new AppError(
      "Cannot delete a size that is being used by products",
      409
    );
  }

  await prisma.size.delete({
    where: {
      id,
    },
  });
};
