import { Request, Response } from "express";

import {
  getAddresses,
  getAddress,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from "../../services/customer/address.service";

import {
  createAddressSchema,
  updateAddressSchema,
} from "../../validations/customer/address.validation";

import AppError from "../../errors/AppError";

export const getAddressesController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user!.id;

  const addresses = await getAddresses(userId);

  res.status(200).json({
    success: true,
    data: addresses,
  });
};

export const getAddressController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user!.id;
  const addressId = Number(req.params.id);

  if (!Number.isInteger(addressId)) {
    throw new AppError("Invalid address ID", 400);
  }

  const address = await getAddress(userId, addressId);

  res.status(200).json({
    success: true,
    data: address,
  });
};

export const createAddressController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user!.id;

  // Previously req.body went straight to the service, unvalidated —
  // createAddressSchema existed but was never called. Fixed here.
  const parsed = createAddressSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400);
  }

  const address = await createAddress(userId, parsed.data);

  res.status(201).json({
    success: true,
    message: "Address created successfully",
    data: address,
  });
};

export const updateAddressController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user!.id;
  const addressId = Number(req.params.id);

  if (!Number.isInteger(addressId)) {
    throw new AppError("Invalid address ID", 400);
  }

  const parsed = updateAddressSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400);
  }

  const address = await updateAddress(userId, addressId, parsed.data);

  res.status(200).json({
    success: true,
    message: "Address updated successfully",
    data: address,
  });
};

export const deleteAddressController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user!.id;
  const addressId = Number(req.params.id);

  if (!Number.isInteger(addressId)) {
    throw new AppError("Invalid address ID", 400);
  }

  const result = await deleteAddress(userId, addressId);

  res.status(200).json({
    success: true,
    message: result.message,
  });
};

export const setDefaultAddressController = async (
  req: Request,
  res: Response
) => {
  const userId = req.user!.id;
  const addressId = Number(req.params.id);

  if (!Number.isInteger(addressId)) {
    throw new AppError("Invalid address ID", 400);
  }

  const address = await setDefaultAddress(userId, addressId);

  res.status(200).json({
    success: true,
    message: "Default address updated successfully",
    data: address,
  });
};
