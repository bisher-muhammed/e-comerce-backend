import { Router } from "express";

import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/authorize.middleware";
import { validate } from "../../middlewares/validate.middleware";

import * as offerController from "../../controllers/admin/offer.controller";

import {
    createOfferSchema,
    updateOfferSchema,
    listOffersQuerySchema,
    getOfferSchema,
    updateOfferStatusSchema,
} from "../../validations/admin/offer.validation";

const router = Router();



router.use(authenticate);

router.use(
    authorize("ADMIN", "SUPER_ADMIN")
);

router.post(
    "/",
    validate({ body: createOfferSchema }),
    offerController.createOfferController
);

router.get(
    "/",
    validate({ query: listOffersQuerySchema }),
    offerController.getOffersController
);



router.get(
    "/:offerId",
    validate({ params: getOfferSchema }),
    offerController.getOfferByIdController
);



router.patch(
    "/:offerId",
    validate({ params: getOfferSchema }),
    validate({ body: updateOfferSchema }),
    offerController.updateOfferController
);



router.patch(
    "/:offerId/status",
    validate({ params: getOfferSchema }),
    validate({ body: updateOfferStatusSchema }),
    offerController.updateOfferStatusController
);



router.delete(
    "/:offerId",
    validate({ params: getOfferSchema }),
    offerController.deleteOfferController
);

export default router;

