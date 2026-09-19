import Razorpay from "razorpay";

import { requireEnv } from "../utils/require-env.util";

const razorpay = new Razorpay({
  key_id: requireEnv("RAZORPAY_KEY_ID"),
  key_secret: requireEnv("RAZORPAY_KEY_SECRET"),
});

export default razorpay;
