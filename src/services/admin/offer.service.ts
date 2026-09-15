import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import {
  CATALOG_NAMESPACE,
  invalidateNamespace,
} from "../../utils/cache.util";
import { ListOffersInput } from "../../validations/admin/offer.validation";

export interface CreateOfferInput {
  type: "PRODUCT" | "CATEGORY";
  productId?: number;
  categoryId?: number;
  discountPercentage: number;
  startsOn: Date;
  expiresOn: Date;
  isActive?: boolean;
}

export interface UpdateOfferInput {
  type?: "PRODUCT" | "CATEGORY";
  productId?: number;
  categoryId?: number;
  discountPercentage?: number;
  startsOn?: Date;
  expiresOn?: Date;
  isActive?: boolean;
}



const isUniqueConstraintError = (
  error: unknown,
): error is { code: "P2002"; meta?: { target?: string[] | string } } =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "P2002";

const rethrowAsOfferConflictError = (error: unknown): never => {
  if (isUniqueConstraintError(error)) {

    throw new AppError(
      "This product or category already has an active offer",
      409,
    );
  }

  throw error;
};

const validateOfferShape = (data: {
  type: "PRODUCT" | "CATEGORY";
  productId?: number;
  categoryId?: number;
}) => {
  if (data.type === "PRODUCT") {
    if (data.productId === undefined) {
      throw new AppError("productId is required for a PRODUCT offer", 400);
    }
    if (data.categoryId !== undefined) {
      throw new AppError(
        "categoryId must not be set for a PRODUCT offer",
        400,
      );
    }
  }

  if (data.type === "CATEGORY") {
    if (data.categoryId === undefined) {
      throw new AppError("categoryId is required for a CATEGORY offer", 400);
    }
    if (data.productId !== undefined) {
      throw new AppError(
        "productId must not be set for a CATEGORY offer",
        400,
      );
    }
  }
};

const validateOfferTargetExists = async (data: {
  type: "PRODUCT" | "CATEGORY";
  productId?: number;
  categoryId?: number;
}) => {
  if (data.type === "PRODUCT") {
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
      select: { id: true, isActive: true },
    });

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    if (!product.isActive) {
      throw new AppError("Cannot create an offer for an inactive product", 409);
    }
  }

  if (data.type === "CATEGORY") {
    const category = await prisma.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true, isActive: true },
    });

    if (!category) {
      throw new AppError("Category not found", 404);
    }

    if (!category.isActive) {
      throw new AppError(
        "Cannot create an offer for an inactive category",
        409,
      );
    }
  }
};

const validateNoActiveOfferOnTarget = async (
  data: {
    type: "PRODUCT" | "CATEGORY";
    productId?: number;
    categoryId?: number;
    isActive?: boolean;
  },
  excludeId?: number,
) => {
  // Only matters if this offer is (or is about to be) active.
  // An inactive offer doesn't conflict with anything.
  if (data.isActive === false) {
    return;
  }

  const existing = await prisma.offer.findFirst({
    where: {
      type: data.type,
      isActive: true,
      ...(data.type === "PRODUCT"
        ? { productId: data.productId }
        : { categoryId: data.categoryId }),
      ...(excludeId !== undefined && { NOT: { id: excludeId } }),
    },
    select: { id: true },
  });

  if (existing) {
    throw new AppError(
      `This ${data.type.toLowerCase()} already has an active offer`,
      409,
    );
  }
};

const offerInclude = {
  product: {
    select: { id: true, name: true, slug: true },
  },
  category: {
    select: { id: true, name: true, slug: true },
  },
};

export const createOffer = async (data: CreateOfferInput) => {
  validateOfferShape(data);

  if (data.startsOn > data.expiresOn) {
    throw new AppError(
      "Start date must be before or equal to expiry date",
      400,
    );
  }

  await validateOfferTargetExists(data);

  await validateNoActiveOfferOnTarget(data);

  try {
    const offer = await prisma.offer.create({
      data: {
        type: data.type,
        productId: data.type === "PRODUCT" ? data.productId : null,
        categoryId: data.type === "CATEGORY" ? data.categoryId : null,
        discountPercentage: data.discountPercentage,
        startsOn: data.startsOn,
        expiresOn: data.expiresOn,
        isActive: data.isActive ?? true,
      },
      include: offerInclude,
    });

    await invalidateNamespace(CATALOG_NAMESPACE);

    return offer;
  } catch (error) {
    rethrowAsOfferConflictError(error);
  }
};

export const listOffers = async (query: ListOffersInput) => {
  const { page, limit, type, productId, categoryId, isActive, orderBy, order } =
    query;

  const where = {
    ...(type !== undefined && { type }),
    ...(productId !== undefined && { productId }),
    ...(categoryId !== undefined && { categoryId }),
    ...(isActive !== undefined && { isActive }),
    ...(query.startDate !== undefined && {
      startsOn: { gte: query.startDate },
    }),
    ...(query.endDate !== undefined && {
      expiresOn: { lte: query.endDate },
    }),
  };

  const [offers, total] = await prisma.$transaction([
    prisma.offer.findMany({
      where,
      orderBy: { [orderBy]: order },
      include: offerInclude,
      skip: (page - 1) * limit,
      take: limit,
    }),

    prisma.offer.count({ where }),
  ]);

  const totalPages = Math.max(Math.ceil(total / limit), 1);

  return {
    offers,

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

export const getOfferById = async (id: number) => {
  const offer = await prisma.offer.findUnique({
    where: { id },
    include: offerInclude,
  });

  if (!offer) {
    throw new AppError("Offer not found", 404);
  }

  return offer;
};

export const updateOffer = async (id: number, data: UpdateOfferInput) => {
  const existing = await prisma.offer.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new AppError("Offer not found", 404);
  }

  if (
    data.type === undefined &&
    data.productId === undefined &&
    data.categoryId === undefined &&
    data.discountPercentage === undefined &&
    data.startsOn === undefined &&
    data.expiresOn === undefined &&
    data.isActive === undefined
  ) {
    throw new AppError("No fields provided for update", 400);
  }


  const merged = {
    type: data.type ?? existing.type,
    productId:
      data.productId !== undefined ? data.productId : existing.productId ?? undefined,
    categoryId:
      data.categoryId !== undefined
        ? data.categoryId
        : existing.categoryId ?? undefined,
    discountPercentage:
      data.discountPercentage ?? Number(existing.discountPercentage),
    startsOn: data.startsOn ?? existing.startsOn,
    expiresOn: data.expiresOn ?? existing.expiresOn,
    isActive: data.isActive ?? existing.isActive,
  };


  if (data.type === "PRODUCT" && data.categoryId === undefined) {
    merged.categoryId = undefined;
  }
  if (data.type === "CATEGORY" && data.productId === undefined) {
    merged.productId = undefined;
  }

  validateOfferShape(merged);

  if (merged.startsOn > merged.expiresOn) {
    throw new AppError(
      "Start date must be before or equal to expiry date",
      400,
    );
  }

  const targetChanged =
    merged.type !== existing.type ||
    merged.productId !== (existing.productId ?? undefined) ||
    merged.categoryId !== (existing.categoryId ?? undefined);

  if (targetChanged) {
    await validateOfferTargetExists(merged);
  }

  if (targetChanged || (data.isActive === true && existing.isActive === false)) {
    await validateNoActiveOfferOnTarget(merged, id);
  }

  try {
    const updated = await prisma.offer.update({
      where: { id },
      data: {
        type: merged.type,
        productId: merged.type === "PRODUCT" ? merged.productId : null,
        categoryId: merged.type === "CATEGORY" ? merged.categoryId : null,
        discountPercentage: merged.discountPercentage,
        startsOn: merged.startsOn,
        expiresOn: merged.expiresOn,
        isActive: merged.isActive,
      },
      include: offerInclude,
    });

    await invalidateNamespace(CATALOG_NAMESPACE);

    return updated;
  } catch (error) {
    rethrowAsOfferConflictError(error);
  }
};

export const updateOfferStatus = async (id: number, isActive: boolean) => {
  const existing = await prisma.offer.findUnique({ where: { id } });

  if (!existing) {
    throw new AppError("Offer not found", 404);
  }

  if (isActive) {
    await validateNoActiveOfferOnTarget(
      {
        type: existing.type as "PRODUCT" | "CATEGORY",
        productId: existing.productId ?? undefined,
        categoryId: existing.categoryId ?? undefined,
        isActive: true,
      },
      id,
    );
  }

  try {
    const updated = await prisma.offer.update({
      where: { id },
      data: { isActive },
      include: offerInclude,
    });

    await invalidateNamespace(CATALOG_NAMESPACE);

    return updated;
  } catch (error) {
    rethrowAsOfferConflictError(error);
  }
};

export const deleteOffer = async (id: number) => {
  const offer = await prisma.offer.findUnique({ where: { id } });

  if (!offer) {
    throw new AppError("Offer not found", 404);
  }

  await prisma.offer.delete({ where: { id } });

  await invalidateNamespace(CATALOG_NAMESPACE);
};


export const getEffectiveOfferForProduct = async (productId: number) => {
  const now = new Date();

  const productOffer = await prisma.offer.findFirst({
    where: {
      productId,
      type: "PRODUCT",
      isActive: true,
      startsOn: { lte: now },
      expiresOn: { gte: now },
    },
  });

  if (productOffer) {
    return productOffer;
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { categoryId: true },
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  return prisma.offer.findFirst({
    where: {
      categoryId: product.categoryId,
      type: "CATEGORY",
      isActive: true,
      startsOn: { lte: now },
      expiresOn: { gte: now },
    },
  });
};