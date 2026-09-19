import "dotenv/config";
import express from "express";
import healthRouter from "./routes/health.route";
import authRouter from "./routes/auth.route";
import adminRouter from "./routes/admin.route";
import categoryRouter from "./routes/category.routes";
import colorRoutes from "./routes/color.routes";
import sizeRoutes from "./routes/size.routes";
import produtRoutes from "./routes/product.route";
import customerProductRoutes from "./routes/customer/product.route";
import cartRouters from "./routes/customer/cart.route";
import wishlistRouters from "./routes/customer/wishlist.route";
import addressRouters from "./routes/customer/address.route";
import checkoutRouters from "./routes/customer/checkout.route";
import orderRouters from "./routes/customer/order.route";
import customerRouters from "./routes/admin/customer.route";
import ordersRouters from "./routes/admin/order.route";
import couponRouters from "./routes/admin/coupon.route";
import couponRouter from "./routes/customer/coupon.route";
import webhookRouter from "./routes/webhook.route";
import staticsRouter from "./routes/admin/statistics.route";
import stockMovementRouter from "./routes/admin/stock-flow.route";
import offerRouters from "./routes/admin/offer.router";
import refundRouters from "./routes/admin/refund.route";
import returnRouters from "./routes/admin/return.route";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import errorMiddleware from "./middlewares/error.middleware";
import { requestId } from "./middlewares/request-id.middleware";
import { auditAdminActions } from "./middlewares/audit.middleware";
import { globalLimiter } from "./middlewares/rate-limit.middleware";
import { resolveTrustProxy } from "./utils/trust-proxy.util";
import {
  isOriginAllowed,
  resolveAllowedOrigins,
} from "./utils/cors-origin.util";

import cookieParser from "cookie-parser";
const app = express();

const allowedOrigins = resolveAllowedOrigins(
  process.env.CORS_ORIGINS
);

app.disable("x-powered-by");

app.set("trust proxy", resolveTrustProxy(process.env.TRUST_PROXY));

app.use(requestId);

app.use(helmet());

app.use(compression());

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin, allowedOrigins)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
  })
);

app.use("/api/v1/webhooks", webhookRouter);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser())

app.use("/api/v1/health", healthRouter);

app.use(globalLimiter);

app.use(auditAdminActions);

app.use("/api/v1/auth", authRouter);

app.use("/api/v1/admin", adminRouter);

app.use("/api/v1/admin/categories", categoryRouter);
app.use("/api/v1/admin/colors", colorRoutes);
app.use("/api/v1/admin/sizes", sizeRoutes);
app.use("/api/v1/admin/products",produtRoutes);
app.use("/api/v1/customer/products",customerProductRoutes);
app.use("/api/v1/customer/cart",cartRouters);
app.use("/api/v1/customer/wishlist",wishlistRouters);
app.use("/api/v1/customer/addresses",addressRouters);
app.use("/api/v1/customer/checkout",checkoutRouters);
app.use("/api/v1/customer/orders",orderRouters);
app.use("/api/v1/admin/customers", customerRouters);
app.use("/api/v1/admin/orders",ordersRouters);
app.use("/api/v1/admin/coupons",couponRouters);
app.use("/api/v1/customer/coupons",couponRouter);
app.use("/api/v1/admin/stock-movements", stockMovementRouter);

app.use("/api/v1/customer/coupons",couponRouter)
app.use("/api/v1/admin/statistics",staticsRouter )
app.use("/api/v1/admin/offers",offerRouters)
app.use("/api/v1/admin/refunds", refundRouters);
app.use("/api/v1/admin/returns", returnRouters);

app.use(errorMiddleware)
export default app;
