import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { UserStatus} from "../../../generated/prisma/enums";

interface ListCustomersParams {
  search?: string;
  status?: UserStatus;
  page?: number;
  limit?: number;
}

export const listCustomers = async ({
  search,
  status,
  page = 1,
  limit = 10,
}: ListCustomersParams = {}) => {
  // Basic pagination validation
  if (page < 1) {
    throw new AppError("Page must be greater than 0", 400);
  }

  if (limit < 1 || limit > 100) {
    throw new AppError("Limit must be between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  const where = {
    role: "CUSTOMER" as const,

    ...(status && {
      status,
    }),

    ...(search?.trim() && {
      OR: [
        {
          firstName: {
            contains: search.trim(),
            mode: "insensitive" as const,
          },
        },
        {
          lastName: {
            contains: search.trim(),
            mode: "insensitive" as const,
          },
        },
        {
          email: {
            contains: search.trim(),
            mode: "insensitive" as const,
          },
        },
      ],
    }),
  };

  const [customers, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),

    prisma.user.count({
      where,
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    customers,

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


export const getCustomerById = async (
  id: number
) => {
  const customer = await prisma.user.findFirst({
    where: {
      id,
      role: "CUSTOMER",
    },

    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404);
  }

  return customer;
};


export const updateCustomerStatus = async (
  id: number,
  status: UserStatus
) => {
  const customer = await prisma.user.findFirst({
    where: {
      id,
      role: "CUSTOMER",
    },

    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404);
  }

  const updatedCustomer = await prisma.user.update({
    where: {
      id: customer.id,
    },

    data: {
      status,
    },

    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updatedCustomer;
};
