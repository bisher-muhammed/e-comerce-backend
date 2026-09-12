import express, { Router } from "express";

import { razorpayWebhookController } from "../controllers/razorpay-webhook.controller";

const router = Router();

router.post(
  "/razorpay",
  express.raw({
    type: "*/*",
    limit: "1mb",
  }),
  razorpayWebhookController
);

export default router;
