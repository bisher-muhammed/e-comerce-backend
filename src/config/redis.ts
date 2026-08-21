import "dotenv/config";
import { createClient } from "redis";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  
});

redis.on("error", (error) => {
  console.error("Redis connection error:", error);
});

export const connectRedis = async (): Promise<void> => {
  if (!redis.isOpen) {
    await redis.connect();
    console.log("Successfully connected to Redis");
  }
};

export default redis;



