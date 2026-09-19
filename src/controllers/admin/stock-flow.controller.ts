import { Request, Response, NextFunction } from "express";
import { validated } from "../../middlewares/validate.middleware";
import type {
  VariantIdParam,
  RestockBody,
  ManualAdjustmentBody,
  ListStockMovementsQuery,
} from "../../validations/admin/stockflow.validation";
import * as stockMovementService from "../../services/admin/stock-movement.service";

export const restockVariantController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { variantId } = validated<VariantIdParam>(req, "params");
    const body = validated<RestockBody>(req, "body");

    const movement = await stockMovementService.restockVariant({
      productVariantId: variantId,
      ...body,
    });

    res.status(201).json({
      success: true,
      data: movement,
    });
  } catch (error) {
    next(error);
  }
};

export const adjustVariantStockController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { variantId } = validated<VariantIdParam>(req, "params");
    const body = validated<ManualAdjustmentBody>(req, "body");

    const movement = await stockMovementService.adjustVariantStock({
      productVariantId: variantId,
      ...body,
    });

    res.status(201).json({
      success: true,
      data: movement,
    });
  } catch (error) {
    next(error);
  }
};

export const listStockMovementsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { variantId } = validated<VariantIdParam>(req, "params");
    const { page, limit } = validated<ListStockMovementsQuery>(req, "query");

    const result = await stockMovementService.listStockMovements({
      productVariantId: variantId,
      page,
      limit,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};