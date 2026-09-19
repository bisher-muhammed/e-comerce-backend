import {
  Request,
  Response,
  NextFunction,
} from "express";

import {
  getOverviewStatistics,
  getRevenueStatistics,
  getOrderStatistics,
  getRevenueByCategory,
  getTopProducts,
  getOrderStatusStatistics,
} from "../../services/admin/statistics.service";

import { validated } from "../../middlewares/validate.middleware";

import type {
  StatisticsDateRangeInput,
  RevenueStatisticsInput,
  OrderStatisticsInput,
  TopProductsStatisticsInput,
} from "../../validations/admin/statistics.validation";

export const getOverviewStatisticsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const query =
      validated<StatisticsDateRangeInput>(
        req,
        "query",
      );

    const statistics =
      await getOverviewStatistics(query);

    return res.status(200).json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    next(error);
  }
};

export const getRevenueStatisticsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const query =
      validated<RevenueStatisticsInput>(
        req,
        "query",
      );

    const statistics =
      await getRevenueStatistics(query);

    return res.status(200).json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderStatisticsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const query =
      validated<OrderStatisticsInput>(
        req,
        "query",
      );

    const statistics =
      await getOrderStatistics(query);

    return res.status(200).json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    next(error);
  }
};

export const getRevenueByCategoryController =
  async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const query =
        validated<StatisticsDateRangeInput>(
          req,
          "query",
        );

      const statistics =
        await getRevenueByCategory(query);

      return res.status(200).json({
        success: true,
        data: statistics,
      });
    } catch (error) {
      next(error);
    }
  };

export const getTopProductsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const query =
      validated<TopProductsStatisticsInput>(
        req,
        "query",
      );

    const statistics =
      await getTopProducts(query);

    return res.status(200).json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderStatusStatisticsController =
  async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const query =
        validated<StatisticsDateRangeInput>(
          req,
          "query",
        );

      const statistics =
        await getOrderStatusStatistics(query);

      return res.status(200).json({
        success: true,
        data: statistics,
      });
    } catch (error) {
      next(error);
    }
  };

  