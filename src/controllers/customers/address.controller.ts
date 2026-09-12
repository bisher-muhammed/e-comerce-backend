import { Request, Response } from "express";

import {
  getAddresses,
  getAddress,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from "../../services/customer/address.service";

import { validated } from "../../middlewares/validate.middleware";

import type {
  AddressIdParam,
  CreateAddressInput,
  UpdateAddressInput,
} from "../../validations/customer/address.validation";

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
  const { id } = validated<AddressIdParam>(req, "params");

  const address = await getAddress(userId, id);

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

  const data = validated<CreateAddressInput>(req, "body");

  const address = await createAddress(userId, data);

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
  const { id } = validated<AddressIdParam>(req, "params");

  const data = validated<UpdateAddressInput>(req, "body");

  const address = await updateAddress(userId, id, data);

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
  const { id } = validated<AddressIdParam>(req, "params");

  const result = await deleteAddress(userId, id);

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
  const { id } = validated<AddressIdParam>(req, "params");

  const address = await setDefaultAddress(userId, id);

  res.status(200).json({
    success: true,
    message: "Default address updated successfully",
    data: address,
  });
};
