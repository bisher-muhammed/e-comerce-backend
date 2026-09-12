import { Resend } from "resend";

import { requireEnv } from "../utils/require-env.util";

const resend = new Resend(
  requireEnv("RESEND_API_KEY")
);

export default resend;
