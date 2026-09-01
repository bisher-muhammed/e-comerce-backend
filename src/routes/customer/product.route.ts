import { Router } from "express";

import { getProductController,getProductBySlugController} from "../../controllers/customers/product.controller"



const router = Router();

router.get("/", getProductController);
router.get("/:slug", getProductBySlugController);

export default router;