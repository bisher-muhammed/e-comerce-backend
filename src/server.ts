import "dotenv/config";
import type { Server } from "node:http";

import app from "./app";
import prisma from "./config/prisma";
import redis, { connectRedis } from "./config/redis";
import {
  startExpiredCheckoutSweeper,
  stopExpiredCheckoutSweeper,
} from "./services/customer/checkout-cleanup.service";
import { closeEmailTransport } from "./services/email.service";

const PORT = process.env.PORT || 5000;

const SHUTDOWN_TIMEOUT_MS = Number(
  process.env.SHUTDOWN_TIMEOUT_MS ?? 15_000
);

let server: Server | null = null;

let shuttingDown = false;

const closeServer = (instance: Server) =>
  new Promise<void>((resolve, reject) => {
    instance.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `Received ${signal}, shutting down gracefully`
  );

  const forceExit = setTimeout(() => {
    console.error(
      "Graceful shutdown timed out, forcing exit"
    );

    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceExit.unref();

  let exitCode = 0;

  try {
    stopExpiredCheckoutSweeper();

    if (server) {
      await closeServer(server);
    }

    await prisma.$disconnect();

    await closeEmailTransport();

    if (redis.isOpen) {
      await redis.quit();
    }
  } catch (error) {
    console.error("Error during shutdown:", error);

    exitCode = 1;
  } finally {
    clearTimeout(forceExit);
  }

  process.exit(exitCode);
};

const startServer = async () => {
  try {
    await connectRedis();

    startExpiredCheckoutSweeper();

    server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. Set PORT to a free port and restart.`
        );
      } else {
        console.error("Server error:", error);
      }

      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

startServer();
