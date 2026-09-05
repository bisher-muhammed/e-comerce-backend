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
import cors from "cors";
import errorMiddleware from "./middlewares/error.middleware";
import cookieParser from "cookie-parser";
const app = express();

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser())

app.use("/api/v1/health", healthRouter);
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







app.use(errorMiddleware)
export default app;
