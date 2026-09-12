import { Router } from "express";

import { getProductController,getProductBySlugController} from "../../controllers/customers/product.controller"

import { validate } from "../../middlewares/validate.middleware";

import { listProductsQuerySchema } from "../../validations/customer/product.validation";

const router = Router();

router.get("/", validate({ query: listProductsQuerySchema }), getProductController);
router.get("/:slug", getProductBySlugController);

export default router;
