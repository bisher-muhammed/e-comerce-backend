import "dotenv/config";
import { createClient } from "redis";
import { logError, logInfo } from "../utils/logger.util";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",

});

redis.on("error", (error) => {
  logError("redis.connection_error", error);
});

let connecting: Promise<void> | null = null;

export const connectRedis = async (): Promise<void> => {
  if (redis.isOpen) {
    return;
  }

  if (!connecting) {
    connecting = redis
      .connect()
      .then(() => {
        logInfo("redis.connected");
      })
      .catch((error) => {
        connecting = null;
        throw error;
      });
  }

  await connecting;
};

export default redis;
