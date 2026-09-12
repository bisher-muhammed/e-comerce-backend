
import { Request, Response, NextFunction } from "express";

import {
  listCustomers,
  getCustomerById,
  updateCustomerStatus,
} from "../../services/admin/list-customer.service";
import { validated } from "../../middlewares/validate.middleware";
import type {
  CustomerIdParam,
  ListCustomersInput,
  UpdateCustomerStatusInput,
} from "../../validations/admin/listcustomer.validation";


export const listCustomersController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      search,
      status,
      page,
      limit,
    } = validated<ListCustomersInput>(
      req,
      "query"
    );

    const result = await listCustomers({
      search,
      status,
      page,
      limit,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomerByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<CustomerIdParam>(
      req,
      "params"
    );

    const customer = await getCustomerById(id);

    return res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    next(error);
  }
};


export const updateCustomerStatusController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = validated<CustomerIdParam>(
      req,
      "params"
    );

    const { status } =
      validated<UpdateCustomerStatusInput>(
        req,
        "body"
      );

    const customer = await updateCustomerStatus(
      id,
      status
    );

    return res.status(200).json({
      success: true,
      message: "Customer status updated successfully",
      data: customer,
    });
  } catch (error) {
    next(error);
  }
};
