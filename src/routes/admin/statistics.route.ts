import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";

import { requirePermission } from "../../middlewares/permission.middleware";

import { validate } from "../../middlewares/validate.middleware";

import {
  getOverviewStatisticsController,
  getRevenueStatisticsController,
  getOrderStatisticsController,
  getRevenueByCategoryController,
  getTopProductsController,
  getOrderStatusStatisticsController,
} from "../../controllers/admin/statistics.controller";

import {
  statisticsDateRangeSchema,
  revenueStatisticsSchema,
  orderStatisticsSchema,
  topProductsStatisticsSchema,
} from "../../validations/admin/statistics.validation";

const router = Router();

router.get(
  "/overview",
  authenticateAdmin,
  requirePermission("stats.view"),
  validate({
    query: statisticsDateRangeSchema,
  }),
  getOverviewStatisticsController
);

router.get(
  "/revenue",
  authenticateAdmin,
  requirePermission("stats.view"),
  validate({
    query: revenueStatisticsSchema,
  }),
  getRevenueStatisticsController
);

router.get(
  "/orders",
  authenticateAdmin,
  requirePermission("stats.view"),
  validate({
    query: orderStatisticsSchema,
  }),
  getOrderStatisticsController
);

router.get(
  "/revenue-by-category",
  authenticateAdmin,
  requirePermission("stats.view"),
  validate({
    query: statisticsDateRangeSchema,
  }),
  getRevenueByCategoryController
);

router.get(
  "/top-products",
  authenticateAdmin,
  requirePermission("stats.view"),
  validate({
    query: topProductsStatisticsSchema,
  }),
  getTopProductsController
);

router.get(
  "/order-status",
  authenticateAdmin,
  requirePermission("stats.view"),
  validate({
    query: statisticsDateRangeSchema,
  }),
  getOrderStatusStatisticsController
);

export default router;
