import { Request, Response, NextFunction } from "express";

import {
  createOffer,
  listOffers,
  getOfferById,
  updateOffer,
  updateOfferStatus,
  deleteOffer,
} from "../../services/admin/offer.service";
import { validated } from "../../middlewares/validate.middleware";
import type {
  OfferIdParam,
  ListOffersInput,
  CreateOfferInput,
  UpdateOfferInput,
  UpdateOfferStatusInput,
} from "../../validations/admin/offer.validation";

export const createOfferController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = validated<CreateOfferInput>(req, "body");

    const offer = await createOffer(data);

    return res.status(200).json({
      success: true,
      message: "Offer created successfully",
      data: offer,
    });
  } catch (error) {
    next(error);
  }
};

export const listOffersController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const query = validated<ListOffersInput>(req, "query");

    const result = await listOffers(query);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getOfferByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<OfferIdParam>(req, "params");

    const offer = await getOfferById(id);

    return res.status(200).json({
      success: true,
      data: offer,
    });
  } catch (error) {
    next(error);
  }
};

export const updateOfferController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<OfferIdParam>(req, "params");

    const data = validated<UpdateOfferInput>(req, "body");

    const offer = await updateOffer(id, data);

    return res.status(200).json({
      success: true,
      message: "Offer updated successfully",
      data: offer,
    });
  } catch (error) {
    next(error);
  }
};

export const updateOfferStatusController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<OfferIdParam>(req, "params");

    const { isActive } = validated<UpdateOfferStatusInput>(req, "body");

    const offer = await updateOfferStatus(id, isActive);

    return res.status(200).json({
      success: true,
      message: "Offer status updated successfully",
      data: offer,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteOfferController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<OfferIdParam>(req, "params");

    await deleteOffer(id);

    return res.status(200).json({
      success: true,
      message: "Offer deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
