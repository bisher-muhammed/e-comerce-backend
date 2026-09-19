import { z } from "zod";

export const statisticsPeriodSchema = z.enum([
  "monthly",
  "yearly",
]);

export const statisticsDateRangeSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.startDate !== undefined &&
      data.endDate !== undefined &&
      data.startDate > data.endDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startDate must be before or equal to endDate",
        path: ["startDate"],
      });
    }
  });

export const overviewStatisticsSchema =
  statisticsDateRangeSchema;

export const revenueStatisticsSchema =
  statisticsDateRangeSchema.extend({
    period: statisticsPeriodSchema.default("monthly"),
  });

export const orderStatisticsSchema =
  statisticsDateRangeSchema.extend({
    period: statisticsPeriodSchema.default("monthly"),
  });

export const revenueByCategoryStatisticsSchema =
  statisticsDateRangeSchema;

export const topProductsStatisticsSchema =
  statisticsDateRangeSchema.extend({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  });

export const orderStatusStatisticsSchema =
  statisticsDateRangeSchema;

// --------------------------------------------------
// Types
// --------------------------------------------------

export type StatisticsDateRangeInput = z.infer<
  typeof statisticsDateRangeSchema
>;

export type StatisticsPeriod = z.infer<
  typeof statisticsPeriodSchema
>;

export type OverviewStatisticsInput = z.infer<
  typeof overviewStatisticsSchema
>;

export type RevenueStatisticsInput = z.infer<
  typeof revenueStatisticsSchema
>;

export type OrderStatisticsInput = z.infer<
  typeof orderStatisticsSchema
>;

export type RevenueByCategoryStatisticsInput = z.infer<
  typeof revenueByCategoryStatisticsSchema
>;

export type TopProductsStatisticsInput = z.infer<
  typeof topProductsStatisticsSchema
>;

export type OrderStatusStatisticsInput = z.infer<
  typeof orderStatusStatisticsSchema
>;
