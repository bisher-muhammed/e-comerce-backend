import "dotenv/config";
import app from "./app";
import { connectRedis } from "./config/redis";
import { startExpiredCheckoutSweeper } from "./services/customer/checkout-cleanup.service";
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectRedis();
    
    startExpiredCheckoutSweeper();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

