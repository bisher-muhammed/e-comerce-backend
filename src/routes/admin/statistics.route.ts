import { Router } from "express";

import { authenticateAdmin } from "../../middlewares/auth.middleware";

import { authorize } from "../../middlewares/authorize.middleware";

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
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    query: statisticsDateRangeSchema,
  }),
  getOverviewStatisticsController
);

router.get(
  "/revenue",
  authenticateAdmin,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    query: revenueStatisticsSchema,
  }),
  getRevenueStatisticsController
);

router.get(
  "/orders",
  authenticateAdmin,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    query: orderStatisticsSchema,
  }),
  getOrderStatisticsController
);

router.get(
  "/revenue-by-category",
  authenticateAdmin,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    query: statisticsDateRangeSchema,
  }),
  getRevenueByCategoryController
);

router.get(
  "/top-products",
  authenticateAdmin,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    query: topProductsStatisticsSchema,
  }),
  getTopProductsController
);

router.get(
  "/order-status",
  authenticateAdmin,
  authorize("ADMIN", "SUPER_ADMIN"),
  validate({
    query: statisticsDateRangeSchema,
  }),
  getOrderStatusStatisticsController
);

export default router;
