import { Router } from "express";

import { validate } from "../../middlewares/validate.middleware";
import { authenticateAdmin } from "../../middlewares/auth.middleware"; 
import { permitByMethod } from "../../middlewares/permission.middleware";
import {
  createOfferController,
  listOffersController,
  getOfferByIdController,
  updateOfferController,
  updateOfferStatusController,
  deleteOfferController,
} from "../../controllers/admin/offer.controller";
import {
  createOfferSchema,
  updateOfferSchema,
  updateOfferStatusSchema,
  listOffersSchema,
  offerIdSchema,
} from "../../validations/admin/offer.validation";

const router = Router();


router.use( authenticateAdmin, permitByMethod("offers.read", "offers.write") );
router.post(
  "/",
  validate({ body: createOfferSchema }),
  createOfferController
);

router.get(
  "/",
  validate({ query: listOffersSchema }),
  listOffersController
);

router.get(
  "/:id",
  validate({ params: offerIdSchema }),
  getOfferByIdController
);

router.patch(
  "/:id",
  validate({ params: offerIdSchema, body: updateOfferSchema }),
  updateOfferController
);

router.patch(
  "/:id/status",
  validate({ params: offerIdSchema, body: updateOfferStatusSchema }),
  updateOfferStatusController
);

router.delete(
  "/:id",
  validate({ params: offerIdSchema }),
  deleteOfferController
);

export default router;
