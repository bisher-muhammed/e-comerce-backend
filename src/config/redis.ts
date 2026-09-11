import "dotenv/config";
import { createClient } from "redis";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",

});

redis.on("error", (error) => {
  console.error("Redis connection error:", error);
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
        console.log("Successfully connected to Redis");
      })
      .catch((error) => {
        connecting = null;
        throw error;
      });
  }

  await connecting;
};

export default redis;
