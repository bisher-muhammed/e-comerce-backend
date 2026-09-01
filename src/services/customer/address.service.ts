import { AddressLabel } from "../../../generated/prisma/enums";
import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";

// GET ALL ADDRESSES

export const getAddresses = async (userId: number) => {
  return prisma.address.findMany({
    where: {
      userId,
    },
    orderBy: [
      {
        isDefault: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });
};

// GET SINGLE ADDRESS

export const getAddress = async (
  userId: number,
  addressId: number
) => {
  const address = await prisma.address.findFirst({
    where: {
      id: addressId,
      userId,
    },
  });

  if (!address) {
    throw new AppError("Address not found", 404);
  }

  return address;
};

export const createAddress = async (
  userId: number,
  data: {
    label?: AddressLabel;
    firstName: string;
    lastName?: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  }
) => {
  const addressCount = await prisma.address.count({
    where: {
      userId,
    },
  });

  return prisma.address.create({
    data: {
      userId,

      label: data.label ?? "HOME",

      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,

      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,

      city: data.city,
      state: data.state,
      postalCode: data.postalCode,

      country: data.country ?? "India",

      isDefault: addressCount === 0,
    },
  });
};

export const updateAddress = async (
  userId: number,
  addressId: number,
  data: {
    label?: AddressLabel;
    firstName?: string;
    lastName?: string;
    phone?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }
) => {
  const address = await prisma.address.findFirst({
    where: {
      id: addressId,
      userId,
    },
  });

  if (!address) {
    throw new AppError("Address not found", 404);
  }


  return prisma.address.update({
    where: {
      id: addressId,
    },
    data: {
      label: data.label,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      state: data.state,
      postalCode: data.postalCode,
      country: data.country,
    },
  });
};

export const deleteAddress = async (
  userId: number,
  addressId: number
) => {
  const address = await prisma.address.findFirst({
    where: {
      id: addressId,
      userId,
    },
  });

  if (!address) {
    throw new AppError("Address not found", 404);
  }

  return prisma.$transaction(async (tx) => {
    await tx.address.delete({
      where: {
        id: addressId,
      },
    });

    if (address.isDefault) {
      const nextAddress = await tx.address.findFirst({
        where: {
          userId,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      if (nextAddress) {
        await tx.address.update({
          where: {
            id: nextAddress.id,
          },
          data: {
            isDefault: true,
          },
        });
      }
    }

    return {
      message: "Address deleted successfully",
    };
  });
};

export const setDefaultAddress = async (
  userId: number,
  addressId: number
) => {
  const address = await prisma.address.findFirst({
    where: {
      id: addressId,
      userId,
    },
  });

  if (!address) {
    throw new AppError("Address not found", 404);
  }

  return prisma.$transaction(async (tx) => {
    await tx.address.updateMany({
      where: {
        userId,
        isDefault: true,
      },
      data: {
        isDefault: false,
      },
    });

    return tx.address.update({
      where: {
        id: addressId,
      },
      data: {
        isDefault: true,
      },
    });
  });
};
