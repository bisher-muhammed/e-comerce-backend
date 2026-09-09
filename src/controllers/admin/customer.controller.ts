
import { Request, Response, NextFunction } from "express";

import {
  listCustomers,
  getCustomerById,
  updateCustomerStatus,
} from "../../services/admin/list-customer.service";
import {listCustomersSchema} from "../../validations/admin/listcustomer.validation";


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
    } = listCustomersSchema.parse(req.query);

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
    const id = Number(req.params.id);

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
    const id = Number(req.params.id);

    const { status } = req.body;

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
