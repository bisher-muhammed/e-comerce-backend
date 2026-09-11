import prisma from "../../config/prisma";

import { withTransactionRetry } from "../../utils/transaction-retry.util";

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

async function releaseExpiredOrder(
  orderId: number
): Promise<boolean> {
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const claimed =
          await tx.order.updateMany({
            where: {
              id: orderId,

              status: "PENDING",

              paymentStatus: "PENDING",

              expiresAt: {
                lte: new Date(),
              },
            },

            data: {
              status: "CANCELLED",

              cancellationReason:
                EXPIRY_REASON,
            },
          });

        if (claimed.count === 0) {
          return false;
        }

        const items =
          await tx.orderItem.findMany({
            where: {
              orderId,

              remainingQuantity: {
                gt: 0,
              },
            },

            select: {
              productVariantId: true,
              remainingQuantity: true,
            },
          });

        for (const item of items) {
          await tx.productVariant.update({
            where: {
              id: item.productVariantId,
            },

            data: {
              stock: {
                increment:
                  item.remainingQuantity,
              },
            },
          });
        }

        await tx.couponClaim.updateMany({
          where: {
            orderId,
          },

          data: {
            usedAt: null,

            orderId: null,
          },
        });

        return true;
      },
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

        console.error(
          `[checkout-sweeper] could not release order ${order.id}`,
          error
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

      if (
        result.released > 0 ||
        result.failed > 0
      ) {
        console.log(
          `[checkout-sweeper] released ${result.released} expired order(s), ${result.failed} failed`
        );
      }
    } catch (error) {
      console.error(
        "[checkout-sweeper] sweep failed",
        error
      );
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
