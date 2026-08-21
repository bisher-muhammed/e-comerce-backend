import express from "express";
import healthRouter from "./routes/health.route";
import authRouter from "./routes/auth.route";
import adminRouter from "./routes/admin.route";
import categoryRouter from "./routes/category.routes";
import colorRoutes from "./routes/color.routes";
import sizeRoutes from "./routes/size.routes";
import produtRoutes from "./routes/product.route";
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


app.use(errorMiddleware)
export default app;
