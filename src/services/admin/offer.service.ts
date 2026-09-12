import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { OfferDiscountType } from "../../../generated/prisma/enums";

import type {
    CreateOfferInput,
    UpdateOfferInput,
    ListOffersQuery,
    OfferIdParams,
    UpdateOfferStatusInput,
} from "../../validations/admin/offer.validation";
// ============================================================
// CREATE OFFER
// ============================================================

export const createOffer = async (data: CreateOfferInput) => {
    const {
        name,
        discountType,
        discountValue,
        startsAt,
        endsAt,
        isActive,
        productIds,
        categoryIds,
    } = data;

    // --------------------------------------------------------
    // BUSINESS VALIDATION
    // --------------------------------------------------------

    if (endsAt <= startsAt) {
        throw new AppError(
            
            "Offer end date must be after start date",400
        );
    }

    if (
        discountType === OfferDiscountType.PERCENTAGE &&
        discountValue > 100
    ) {
        throw new AppError(
            "Percentage discount cannot exceed 100%",
            400
        );
    }

    if (
        productIds.length === 0 &&
        categoryIds.length === 0
    ) {
        throw new AppError(
            "Offer must target at least one product or category",
            400
        );
    }

    // --------------------------------------------------------
    // CHECK TARGETS EXIST
    // --------------------------------------------------------

    const uniqueProductIds = [...new Set(productIds)];
    const uniqueCategoryIds = [...new Set(categoryIds)];

    if (uniqueProductIds.length > 0) {
        const productCount = await prisma.product.count({
            where: {
                id: {
                    in: uniqueProductIds,
                },
            },
        });

        if (productCount !== uniqueProductIds.length) {
            throw new AppError(
                "One or more selected products do not exist",
                400
            );
        }
    }

    if (uniqueCategoryIds.length > 0) {
        const categoryCount = await prisma.category.count({
            where: {
                id: {
                    in: uniqueCategoryIds,
                },
            },
        });

        if (categoryCount !== uniqueCategoryIds.length) {
            throw new AppError(
                "One or more selected categories do not exist",
                400
            );
        }
    }

    // --------------------------------------------------------
    // CREATE OFFER + TARGETS
    // --------------------------------------------------------

    const offer = await prisma.$transaction(async (tx) => {
        return tx.offer.create({
            data: {
                name,
                discountType,
                discountValue,
                startsAt,
                endsAt,
                isActive,

                products: {
                    create: uniqueProductIds.map((productId) => ({
                        productId,
                    })),
                },

                categories: {
                    create: uniqueCategoryIds.map((categoryId) => ({
                        categoryId,
                    })),
                },
            },

            include: {
                products: {
                    include: {
                        product: true,
                    },
                },

                categories: {
                    include: {
                        category: true,
                    },
                },
            },
        });
    });

    return offer;
};

// ============================================================
// GET OFFERS
// ============================================================

export const getOffers = async (
    query: ListOffersQuery
) => {
    const {
        page,
        limit,
        search,
        discountType,
        isActive,
        startsFrom,
        startsTo,
        endsFrom,
        endsTo,
        sortBy,
        sortOrder,
    } = query;

    const skip = (page - 1) * limit;

    const where = {
        ...(search
            ? {
                  name: {
                      contains: search,
                      mode: "insensitive" as const,
                  },
              }
            : {}),

        ...(discountType
            ? {
                  discountType,
              }
            : {}),

        ...(isActive !== undefined
            ? {
                  isActive,
              }
            : {}),

        ...(startsFrom || startsTo
            ? {
                  startsAt: {
                      ...(startsFrom
                          ? { gte: startsFrom }
                          : {}),
                      ...(startsTo
                          ? { lte: startsTo }
                          : {}),
                  },
              }
            : {}),

        ...(endsFrom || endsTo
            ? {
                  endsAt: {
                      ...(endsFrom
                          ? { gte: endsFrom }
                          : {}),
                      ...(endsTo
                          ? { lte: endsTo }
                          : {}),
                  },
              }
            : {}),
    };

    const [offers, total] = await prisma.$transaction([
        prisma.offer.findMany({
            where,

            skip,
            take: limit,

            orderBy: {
                [sortBy]: sortOrder,
            },

            include: {
                products: {
                    select: {
                        productId: true,
                        product: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                            },
                        },
                    },
                },

                categories: {
                    select: {
                        categoryId: true,
                        category: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                            },
                        },
                    },
                },
            },
        }),

        prisma.offer.count({
            where,
        }),
    ]);

    return {
        offers,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

// ============================================================
// GET OFFER BY ID
// ============================================================

export const getOfferById = async (
    params: OfferIdParams
) => {
    const { offerId } = params;

    const offer = await prisma.offer.findUnique({
        where: {
            id: offerId,
        },

        include: {
            products: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            isActive: true,
                        },
                    },
                },
            },

            categories: {
                include: {
                    category: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            isActive: true,
                        },
                    },
                },
            },
        },
    });

    if (!offer) {
        throw new AppError("Offer not found", 404);
    }

    return offer;
};

// ============================================================
// UPDATE OFFER
// ============================================================

export const updateOffer = async (
    params: OfferIdParams,
    data: UpdateOfferInput
) => {
    const { offerId } = params;

    // --------------------------------------------------------
    // CHECK OFFER EXISTS
    // --------------------------------------------------------

    const existingOffer = await prisma.offer.findUnique({
        where: {
            id: offerId,
        },

        include: {
            products: true,
            categories: true,
        },
    });

    if (!existingOffer) {
        throw new AppError("Offer not found",404);
    }

    // --------------------------------------------------------
    // RESOLVE FINAL VALUES
    // --------------------------------------------------------
    //
    // If a field isn't supplied, keep the existing value.
    //

    const finalDiscountType =
        data.discountType ?? existingOffer.discountType;

    const finalDiscountValue =
        data.discountValue ??
        Number(existingOffer.discountValue);

    const finalStartsAt =
        data.startsAt ?? existingOffer.startsAt;

    const finalEndsAt =
        data.endsAt ?? existingOffer.endsAt;

    // --------------------------------------------------------
    // BUSINESS VALIDATION
    // --------------------------------------------------------

    if (finalEndsAt <= finalStartsAt) {
        throw new AppError(
        
            "Offer end date must be after start date",400
        );
    }

    if (
        finalDiscountType === OfferDiscountType.PERCENTAGE &&
        finalDiscountValue > 100
    ) {
        throw new AppError(
            
            "Percentage discount cannot exceed 100%",400
        );
    }

    // --------------------------------------------------------
    // TARGETS
    // --------------------------------------------------------
    //
    // If productIds/categoryIds are not supplied, preserve
    // existing targets.
    //
    // If supplied, replace those target lists.
    //

    const productIds =
        data.productIds !== undefined
            ? [...new Set(data.productIds)]
            : existingOffer.products.map(
                  (item) => item.productId
              );

    const categoryIds =
        data.categoryIds !== undefined
            ? [...new Set(data.categoryIds)]
            : existingOffer.categories.map(
                  (item) => item.categoryId
              );

    if (
        productIds.length === 0 &&
        categoryIds.length === 0
    ) {
        throw new AppError(
            
            "Offer must target at least one product or category",400
        );
    }

    // --------------------------------------------------------
    // CHECK PRODUCTS
    // --------------------------------------------------------

    if (data.productIds !== undefined) {
        const productCount = await prisma.product.count({
            where: {
                id: {
                    in: productIds,
                },
            },
        });

        if (productCount !== productIds.length) {
            throw new AppError(
                
                "One or more selected products do not exist",400
            );
        }
    }

    // --------------------------------------------------------
    // CHECK CATEGORIES
    // --------------------------------------------------------

    if (data.categoryIds !== undefined) {
        const categoryCount =
            await prisma.category.count({
                where: {
                    id: {
                        in: categoryIds,
                    },
                },
            });

        if (categoryCount !== categoryIds.length) {
            throw new AppError(
                
                "One or more selected categories do not exist",400
            );
        }
    }

    // --------------------------------------------------------
    // UPDATE
    // --------------------------------------------------------

    const updatedOffer = await prisma.$transaction(
        async (tx) => {
            // ----------------------------------------------
            // Update main offer
            // ----------------------------------------------

            await tx.offer.update({
                where: {
                    id: offerId,
                },

                data: {
                    ...(data.name !== undefined && {
                        name: data.name,
                    }),

                    discountType: finalDiscountType,

                    discountValue: finalDiscountValue,

                    startsAt: finalStartsAt,

                    endsAt: finalEndsAt,

                    ...(data.isActive !== undefined && {
                        isActive: data.isActive,
                    }),
                },
            });

            // ----------------------------------------------
            // Replace product targets
            // ----------------------------------------------

            if (data.productIds !== undefined) {
                await tx.offerProduct.deleteMany({
                    where: {
                        offerId,
                    },
                });

                if (productIds.length > 0) {
                    await tx.offerProduct.createMany({
                        data: productIds.map((productId) => ({
                            offerId,
                            productId,
                        })),
                    });
                }
            }

            // ----------------------------------------------
            // Replace category targets
            // ----------------------------------------------

            if (data.categoryIds !== undefined) {
                await tx.offerCategory.deleteMany({
                    where: {
                        offerId,
                    },
                });

                if (categoryIds.length > 0) {
                    await tx.offerCategory.createMany({
                        data: categoryIds.map((categoryId) => ({
                            offerId,
                            categoryId,
                        })),
                    });
                }
            }

            // ----------------------------------------------
            // Return complete offer
            // ----------------------------------------------

            return tx.offer.findUnique({
                where: {
                    id: offerId,
                },

                include: {
                    products: {
                        include: {
                            product: true,
                        },
                    },

                    categories: {
                        include: {
                            category: true,
                        },
                    },
                },
            });
        }
    );

    return updatedOffer;
};

// ============================================================
// UPDATE OFFER STATUS
// ============================================================

export const updateOfferStatus = async (
    params: OfferIdParams,
    data: UpdateOfferStatusInput
) => {
    const { offerId } = params;

    const existingOffer = await prisma.offer.findUnique({
        where: {
            id: offerId,
        },
        select: {
            id: true,
        },
    });

    if (!existingOffer) {
        throw new AppError( "Offer not found",400);
    }

    const offer = await prisma.offer.update({
        where: {
            id: offerId,
        },

        data: {
            isActive: data.isActive,
        },
    });

    return offer;
};

// ============================================================
// DELETE OFFER
// ============================================================

export const deleteOffer = async (
    params: OfferIdParams
) => {
    const { offerId } = params;

    const existingOffer = await prisma.offer.findUnique({
        where: {
            id: offerId,
        },

        select: {
            id: true,
        },
    });

    if (!existingOffer) {
        throw new AppError("Offer not found",400);
    }

    await prisma.offer.delete({
        where: {
            id: offerId,
        },
    });

    return {
        message: "Offer deleted successfully",
    };
};
