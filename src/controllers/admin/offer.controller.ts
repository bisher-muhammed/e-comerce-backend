import { Request, Response } from "express";

import {
    createOffer,
    getOffers,
    getOfferById,
    updateOffer,
    updateOfferStatus,
    deleteOffer,
} from "../../services/admin/offer.service";

import {
    listOffersQuerySchema,
    getOfferSchema,
    updateOfferParamsSchema,
    updateOfferSchema,
    updateOfferStatusSchema,
    deleteOfferSchema,
} from "../../validations/admin/offer.validation";

// ============================================================
// CREATE OFFER
// ============================================================

export const createOfferController = async (
    req: Request,
    res: Response
) => {
    const offer = await createOffer(req.body);

    res.status(201).json({
        success: true,
        message: "Offer created successfully",
        data: offer,
    });
};

// ============================================================
// GET OFFERS
// ============================================================

export const getOffersController = async (
    req: Request,
    res: Response
) => {
    // Express gives query values as strings.
    // Zod converts them to the correct types.
    const query = listOffersQuerySchema.parse(req.query);

    const result = await getOffers(query);

    res.status(200).json({
        success: true,
        data: result,
    });
};

// ============================================================
// GET OFFER BY ID
// ============================================================

export const getOfferByIdController = async (
    req: Request,
    res: Response
) => {
    const params = getOfferSchema.parse(req.params);

    const offer = await getOfferById(params);

    res.status(200).json({
        success: true,
        data: offer,
    });
};

// ============================================================
// UPDATE OFFER
// ============================================================

export const updateOfferController = async (
    req: Request,
    res: Response
) => {
    const params = updateOfferParamsSchema.parse(
        req.params
    );

    const data = updateOfferSchema.parse(req.body);

    const offer = await updateOffer(params, data);

    res.status(200).json({
        success: true,
        message: "Offer updated successfully",
        data: offer,
    });
};

// ============================================================
// UPDATE OFFER STATUS
// ============================================================

export const updateOfferStatusController = async (
    req: Request,
    res: Response
) => {
    const params = updateOfferParamsSchema.parse(
        req.params
    );

    const data = updateOfferStatusSchema.parse(
        req.body
    );

    const offer = await updateOfferStatus(params, data);

    res.status(200).json({
        success: true,
        message: "Offer status updated successfully",
        data: offer,
    });
};

// ============================================================
// DELETE OFFER
// ============================================================

export const deleteOfferController = async (
    req: Request,
    res: Response
) => {
    const params = deleteOfferSchema.parse(req.params);

    const result = await deleteOffer(params);

    res.status(200).json({
        success: true,
        message: result.message,
    });
};
