import prisma from "../../config/prisma";

import { withTransactionRetry } from "../../utils/transaction-retry.util";

import { cancelUnpaidPendingOrder } from "../../utils/order-cancellation.util";

import { logError, logInfo } from "../../utils/logger.util";

const SWEEP_INTERVAL_MS = 60 * 1000;

const SWEEP_BATCH_SIZE = 100;

const MAX_BATCHES_PER_SWEEP = 20;

const EXPIRY_REASON =
  "Payment window expired";

let sweepTimer: NodeJS.Timeout | null =
  null;

let sweepInProgress = false;

// ------------------------------------------------------------
// RELEASE ONE ORDER
// ------------------------------------------------------------

export async function releaseExpiredOrder(
  orderId: number
): Promise<boolean> {
  return withTransactionRetry(() =>
    prisma.$transaction(
      (tx) =>
        cancelUnpaidPendingOrder(tx, orderId, {
          reason: EXPIRY_REASON,
          idempotencyKey: `system:expired:${orderId}`,
          onlyIfExpired: true,
        }),
      {
        isolationLevel: "Serializable",

        maxWait: 5000,

        timeout: 10000,
      }
    )
  );
}

// ------------------------------------------------------------
// SWEEP
// ------------------------------------------------------------

export async function sweepExpiredCheckouts() {
  let scanned = 0;

  let released = 0;

  let failed = 0;

  // Orders that failed this sweep are not retried until the next one,
  // otherwise a single poisoned order would be re-read every batch.
  const failedIds: number[] = [];

  for (
    let batch = 0;
    batch < MAX_BATCHES_PER_SWEEP;
    batch++
  ) {
    // Served by @@index([status, paymentStatus, expiresAt]).
    const expired =
      await prisma.order.findMany({
        where: {
          status: "PENDING",

          paymentStatus: "PENDING",

          expiresAt: {
            lte: new Date(),
          },

          ...(failedIds.length > 0
            ? { id: { notIn: failedIds } }
            : {}),
        },

        select: {
          id: true,
        },

        orderBy: {
          expiresAt: "asc",
        },

        take: SWEEP_BATCH_SIZE,
      });

    if (expired.length === 0) {
      break;
    }

    scanned += expired.length;

    for (const order of expired) {
      try {
        const didRelease =
          await releaseExpiredOrder(
            order.id
          );

        if (didRelease) {
          released++;
        }
      } catch (error) {
        failed++;

        failedIds.push(order.id);

        logError(
          "checkout_sweeper.release_failed",
          error,
          { orderId: order.id, alert: true }
        );
      }
    }

    if (
      expired.length < SWEEP_BATCH_SIZE
    ) {
      break;
    }
  }

  return {
    scanned,
    released,
    failed,
  };
}

// ------------------------------------------------------------
// SCHEDULER
// ------------------------------------------------------------

export function startExpiredCheckoutSweeper(
  intervalMs: number = SWEEP_INTERVAL_MS
) {
  if (sweepTimer) {
    return;
  }

  const tick = async () => {
    // A slow sweep must not overlap the next tick.
    if (sweepInProgress) {
      return;
    }

    sweepInProgress = true;

    try {
      const result =
        await sweepExpiredCheckouts();

      if (result.failed > 0) {
        logError(
          "checkout_sweeper.sweep_incomplete",
          new Error(
            `${result.failed} expired order(s) could not be released`
          ),
          { ...result, alert: true }
        );
      } else if (result.released > 0) {
        logInfo("checkout_sweeper.released", result);
      }
    } catch (error) {
      logError("checkout_sweeper.sweep_failed", error, {
        alert: true,
      });
    } finally {
      sweepInProgress = false;
    }
  };

  sweepTimer = setInterval(
    tick,
    intervalMs
  );

  // Don't hold the process open on shutdown.
  sweepTimer.unref();

  // Clear whatever expired while the process was down.
  void tick();
}

export function stopExpiredCheckoutSweeper() {
  if (sweepTimer) {
    clearInterval(sweepTimer);

    sweepTimer = null;
  }
}
