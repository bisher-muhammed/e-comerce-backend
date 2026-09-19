import { Prisma } from "../../../generated/prisma/client";
import { OrderStatus } from "../../../generated/prisma/enums";

import prisma from "../../config/prisma";

import type {
  StatisticsDateRangeInput,
  OrderStatisticsInput,
  RevenueStatisticsInput,
  TopProductsStatisticsInput,
} from "../../validations/admin/statistics.validation";

const getDateRange = (
  startDate?: Date,
  endDate?: Date,
) => {
  const now = new Date();

  if (startDate || endDate) {
    return {
      startDate: startDate ?? new Date(0),
      endDate: endDate ?? now,
    };
  }

  return {
    startDate: new Date(now.getFullYear(), 0, 1),
    endDate: now,
  };
};

export const getOverviewStatistics = async (
  query?: StatisticsDateRangeInput,
) => {
  const { startDate, endDate } = getDateRange(
    query?.startDate,
    query?.endDate,
  );

  const [revenue, customers] = await prisma.$transaction([
    prisma.order.aggregate({
      where: {
        status: OrderStatus.DELIVERED,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        total: true,
        refundedAmount: true,
      },
      _count: {
        id: true,
      },
      _avg: {
        total: true,
      },
    }),

    prisma.user.count({
      where: {
        role: "CUSTOMER",
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
  ]);

  const grossRevenue = Number(
    revenue._sum.total ?? 0,
  );

  const refundedAmount = Number(
    revenue._sum.refundedAmount ?? 0,
  );

  const netRevenue =
    grossRevenue - refundedAmount;

  const averageOrderValue = Number(
    revenue._avg.total ?? 0,
  );

  const completedOrders = revenue._count.id;

  return {
    grossRevenue,
    refundedAmount,
    netRevenue,
    completedOrders,
    averageOrderValue,
    customers,
  };
};

type RevenueRow = {
  period_start: Date;
  revenue: Prisma.Decimal | string | number;
  refunded_amount: Prisma.Decimal | string | number;
  orders: bigint | number;
};

export const getRevenueStatistics = async (
  query: RevenueStatisticsInput,
) => {
  const { startDate, endDate } = getDateRange(
    query.startDate,
    query.endDate,
  );

  const truncUnit =
    query.period === "yearly"
      ? "year"
      : "month";

  const rows =
    await prisma.$queryRaw<RevenueRow[]>`
      SELECT
        DATE_TRUNC(
          ${truncUnit},
          "createdAt" AT TIME ZONE 'UTC'
        ) AS period_start,

        SUM(
          "total" - "refundedAmount"
        ) AS revenue,

        SUM(
          "refundedAmount"
        ) AS refunded_amount,

        COUNT(*) AS orders

      FROM "Order"

      WHERE
        "status" =
          ${OrderStatus.DELIVERED}::"OrderStatus"

        AND "createdAt" >= ${startDate}

        AND "createdAt" <= ${endDate}

      GROUP BY period_start
      ORDER BY period_start ASC
    `;

  return rows.map((row) => {
    const date = row.period_start;

    const period =
      query.period === "yearly"
        ? String(date.getUTCFullYear())
        : `${date.getUTCFullYear()}-${String(
            date.getUTCMonth() + 1,
          ).padStart(2, "0")}`;

    return {
      period,
      revenue: Number(row.revenue ?? 0),
      refundedAmount: Number(
        row.refunded_amount ?? 0,
      ),
      orders: Number(row.orders),
    };
  });
};

type OrderCountRow = {
  period_start: Date;
  orders: bigint | number;
};

export const getOrderStatistics = async (
  query: OrderStatisticsInput,
) => {
  const { startDate, endDate } = getDateRange(
    query.startDate,
    query.endDate,
  );

  const truncUnit =
    query.period === "yearly"
      ? "year"
      : "month";

  const rows =
    await prisma.$queryRaw<OrderCountRow[]>`
      SELECT
        DATE_TRUNC(
          ${truncUnit},
          "createdAt" AT TIME ZONE 'UTC'
        ) AS period_start,

        COUNT(*) AS orders

      FROM "Order"

      WHERE
        "status" =
          ${OrderStatus.DELIVERED}::"OrderStatus"

        AND "createdAt" >= ${startDate}

        AND "createdAt" <= ${endDate}

      GROUP BY period_start
      ORDER BY period_start ASC
    `;

  return rows.map((row) => {
    const date = row.period_start;

    const period =
      query.period === "yearly"
        ? String(date.getUTCFullYear())
        : `${date.getUTCFullYear()}-${String(
            date.getUTCMonth() + 1,
          ).padStart(2, "0")}`;

    return {
      period,
      orders: Number(row.orders),
    };
  });
};

type CategoryRevenueRow = {
  category_id: number;
  category_name: string;
  revenue: Prisma.Decimal | string | number;
  units_sold: bigint | number;
};

export const getRevenueByCategory = async (
  query?: StatisticsDateRangeInput,
) => {
  const { startDate, endDate } = getDateRange(
    query?.startDate,
    query?.endDate,
  );

  const rows =
    await prisma.$queryRaw<CategoryRevenueRow[]>`
      SELECT
        c."id" AS category_id,
        c."name" AS category_name,

        SUM(
          oi."price" *
          (
            oi."quantity"
            - oi."cancelledQuantity"
            - oi."returnedQuantity"
          )
        ) AS revenue,

        SUM(
          oi."quantity"
          - oi."cancelledQuantity"
          - oi."returnedQuantity"
        ) AS units_sold

      FROM "OrderItem" oi

      JOIN "Order" o
        ON o."id" = oi."orderId"

      JOIN "ProductVariant" pv
        ON pv."id" = oi."productVariantId"

      JOIN "ProductColor" pc
        ON pc."id" = pv."productColorId"

      JOIN "Product" p
        ON p."id" = pc."productId"

      JOIN "Category" c
        ON c."id" = p."categoryId"

      WHERE
        o."status" =
          ${OrderStatus.DELIVERED}::"OrderStatus"

        AND o."createdAt" >= ${startDate}

        AND o."createdAt" <= ${endDate}

      GROUP BY
        c."id",
        c."name"

      ORDER BY revenue DESC
    `;

  return rows.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    revenue: Number(row.revenue ?? 0),
    unitsSold: Number(row.units_sold ?? 0),
  }));
};

type TopProductRow = {
  product_name: string;
  revenue: Prisma.Decimal | string | number;
  units_sold: bigint | number;
};

export const getTopProducts = async (
  query: TopProductsStatisticsInput,
) => {
  const { startDate, endDate } = getDateRange(
    query.startDate,
    query.endDate,
  );

  const rows =
    await prisma.$queryRaw<TopProductRow[]>`
      SELECT
        oi."productName" AS product_name,

        SUM(
          oi."price" *
          (
            oi."quantity"
            - oi."cancelledQuantity"
            - oi."returnedQuantity"
          )
        ) AS revenue,

        SUM(
          oi."quantity"
          - oi."cancelledQuantity"
          - oi."returnedQuantity"
        ) AS units_sold

      FROM "OrderItem" oi

      JOIN "Order" o
        ON o."id" = oi."orderId"

      WHERE
        o."status" =
          ${OrderStatus.DELIVERED}::"OrderStatus"

        AND o."createdAt" >= ${startDate}

        AND o."createdAt" <= ${endDate}

      GROUP BY oi."productName"

      ORDER BY revenue DESC

      LIMIT ${query.limit}
    `;

  return rows.map((row) => ({
    productName: row.product_name,
    revenue: Number(row.revenue ?? 0),
    unitsSold: Number(row.units_sold ?? 0),
  }));
};

export const getOrderStatusStatistics = async (
  query?: StatisticsDateRangeInput,
) => {
  const { startDate, endDate } = getDateRange(
    query?.startDate,
    query?.endDate,
  );

  const orders = await prisma.order.groupBy({
    by: ["status"],

    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },

    _count: {
      id: true,
    },
  });

  return orders.map((item) => ({
    status: item.status,
    orders: item._count.id,
  }));
};
