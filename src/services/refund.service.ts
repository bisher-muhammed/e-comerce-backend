/*
 * Refunds (audit H2).
 *
 * A refund is a money movement at Razorpay that this database can only
 * observe. The rules below keep the local books from ever paying twice:
 *
 *  - reserve first: a Refund row (PENDING) is created and, for the
 *    order's own payment, Order.refundedAmount is incremented in the same
 *    transaction. Concurrent reservations race on refundedAmount and only
 *    one wins.
 *  - a reservation is released (row FAILED, refundedAmount decremented)
 *    ONLY when Razorpay definitively rejected the request (4xx) or later
 *    reports the refund as failed.
 *  - any other outcome (timeout, network error, 5xx, crash, or a database
 *    error after Razorpay accepted) leaves the row PENDING. It keeps its
 *    reservation, so nothing else can claim the same money, and the
 *    worker reconciles it against Razorpay's refund list, matching on
 *    notes.refundId.
 *  - FAILED amounts are owed again; the worker re-issues them with
 *    backoff and raises a dead-letter alert after MAX_AUTO_ATTEMPTS.
 *
 * Status meaning:
 *   PENDING   reserved; Razorpay outcome unknown or refund not settled yet
 *             (razorpayRefundId set = Razorpay accepted it)
 *   PROCESSED Razorpay reports the refund processed (terminal)
 *   FAILED    definitively not refunded; reservation released (terminal)
 */
import prisma from "../config/prisma";
import razorpay from "../config/razorpay";
import { Prisma } from "../../generated/prisma/client";
import { refundableAmount } from "../utils/order-amount.util";
import { logError, logInfo } from "../utils/logger.util";

const ZERO = new Prisma.Decimal(0);

/** A PENDING row younger than this may still have a request in flight. */
export const RECONCILE_AFTER_MS = 2 * 60 * 1000;

/**
 * A PENDING row with no Razorpay id that Razorpay still does not know
 * about after this long never reached Razorpay: safe to release.
 */
export const ASSUME_NOT_CREATED_AFTER_MS = 15 * 60 * 1000;

export const MAX_AUTO_ATTEMPTS = 5;

const RETRY_BASE_DELAY_MS = 5 * 60 * 1000;

export type RefundOutcome =
    | {
          status: "SKIPPED";
          reason: string;
      }
    | {
          status: "PROCESSED";
          refundId: number;
          amount: string;
          razorpayRefundId: string;
      }
    | {
          status: "PENDING";
          refundId: number;
          amount: string;
          razorpayRefundId: string | null;
          reason: string;
      }
    | {
          status: "FAILED";
          refundId: number;
          amount: string;
          failureReason: string;
      };

type RefundRow = {
    id: number;
    orderId: number;
    amount: Prisma.Decimal;
    status: "PENDING" | "PROCESSED" | "FAILED";
    razorpayPaymentId: string;
    razorpayRefundId: string | null;
    failureReason: string | null;
    orphanPayment: boolean;
    createdAt: Date;
};

// ============================================================
// HELPERS
// ============================================================

function toPaise(amount: Prisma.Decimal): number {
    return amount.mul(100).toDecimalPlaces(0).toNumber();
}

/** Human-readable text from whatever the Razorpay SDK rejected with. */
export function describeRazorpayError(error: unknown): string {
    if (error && typeof error === "object" && "error" in error) {
        const inner = (
            error as { error?: { description?: string; code?: string } }
        ).error;

        if (inner?.description) {
            return inner.description;
        }

        if (inner?.code) {
            return inner.code;
        }
    }

    if (error instanceof Error) {
        return error.message;
    }

    return "Unknown refund error";
}

/**
 * Definitive = Razorpay answered and refused, so no money moved. The SDK
 * rejects with { statusCode, error } only when it got an HTTP response;
 * a timeout or network failure surfaces as a plain Error/TypeError with
 * no status, and that is exactly the case where the refund may exist.
 */
export function isDefinitiveRejection(error: unknown): boolean {
    const statusCode =
        error && typeof error === "object"
            ? (error as { statusCode?: unknown }).statusCode
            : undefined;

    return (
        typeof statusCode === "number" &&
        statusCode >= 400 &&
        statusCode < 500 &&
        statusCode !== 408 &&
        statusCode !== 409
    );
}

function outcomeFromRow(row: RefundRow): RefundOutcome {
    const amount = row.amount.toFixed(2);

    if (row.status === "PROCESSED") {
        return {
            status: "PROCESSED",
            refundId: row.id,
            amount,
            razorpayRefundId: row.razorpayRefundId ?? "",
        };
    }

    if (row.status === "FAILED") {
        return {
            status: "FAILED",
            refundId: row.id,
            amount,
            failureReason:
                row.failureReason ??
                "Refund failed; retry with a new idempotency key",
        };
    }

    return {
        status: "PENDING",
        refundId: row.id,
        amount,
        razorpayRefundId: row.razorpayRefundId,
        reason: row.razorpayRefundId
            ? "Refund accepted by Razorpay and awaiting settlement"
            : "Refund outcome is being confirmed with Razorpay",
    };
}

const loadRow = (id: number) =>
    prisma.refund.findUniqueOrThrow({ where: { id } }) as Promise<RefundRow>;

// ============================================================
// STATE TRANSITIONS (only ever from PENDING)
// ============================================================

/**
 * PENDING → FAILED, releasing the reservation. Returns false if the row
 * had already left PENDING (e.g. a webhook settled it first).
 */
export async function markRefundFailed(
    refundId: number,
    failureReason: string,
    razorpayRefundId?: string
): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
        const row = await tx.refund.findUniqueOrThrow({
            where: { id: refundId },
            select: { orderId: true, amount: true, orphanPayment: true },
        });

        const moved = await tx.refund.updateMany({
            where: { id: refundId, status: "PENDING" },
            data: {
                status: "FAILED",
                failureReason: failureReason.slice(0, 500),
                ...(razorpayRefundId ? { razorpayRefundId } : {}),
            },
        });

        if (moved.count === 0) {
            return false;
        }

        if (!row.orphanPayment) {
            await tx.order.updateMany({
                where: {
                    id: row.orderId,
                    refundedAmount: { gte: row.amount },
                },
                data: { refundedAmount: { decrement: row.amount } },
            });
        }

        return true;
    });
}

/** PENDING → PROCESSED. */
export async function markRefundProcessed(
    refundId: number,
    razorpayRefundId: string
): Promise<boolean> {
    const moved = await prisma.refund.updateMany({
        where: { id: refundId, status: "PENDING" },
        data: {
            status: "PROCESSED",
            razorpayRefundId,
            failureReason: null,
        },
    });

    if (moved.count === 1) {
        const { orderId } = await prisma.refund.findUniqueOrThrow({
            where: { id: refundId },
            select: { orderId: true },
        });

        await settleReturnsForOrder(orderId);
    }

    return moved.count === 1;
}

type RazorpayRefundState = {
    id: string;
    status?: string;
};

/** Applies what Razorpay says about a refund to our row. */
async function applyRazorpayState(
    refundId: number,
    remote: RazorpayRefundState
): Promise<void> {
    if (remote.status === "processed") {
        await markRefundProcessed(refundId, remote.id);
        return;
    }

    if (remote.status === "failed") {
        if (await markRefundFailed(refundId, "Razorpay reported the refund as failed", remote.id)) {
            logError(
                "refund.failed",
                new Error("Razorpay reported the refund as failed"),
                { refundId, alert: true }
            );
        }
        return;
    }

    // created / pending: accepted, not settled yet.
    await prisma.refund.updateMany({
        where: { id: refundId, status: "PENDING" },
        data: { razorpayRefundId: remote.id, failureReason: null },
    });
}

// ============================================================
// SUBMIT
// ============================================================

async function submitToRazorpay(row: RefundRow): Promise<RefundOutcome> {
    let remote: RazorpayRefundState;

    try {
        remote = (await razorpay.payments.refund(row.razorpayPaymentId, {
            amount: toPaise(row.amount),
            speed: "normal",
            // Razorpay caps receipts at 40 characters.
            receipt: `refund_${row.id}`,
            notes: {
                orderId: String(row.orderId),
                refundId: String(row.id),
            },
        })) as RazorpayRefundState;
    } catch (error) {
        const message = describeRazorpayError(error);

        if (isDefinitiveRejection(error)) {
            await markRefundFailed(row.id, message);

            logError("refund.failed", new Error(message), {
                orderId: row.orderId,
                refundId: row.id,
                alert: true,
            });

            return outcomeFromRow(await loadRow(row.id));
        }

        // Unknown outcome: keep the reservation, reconcile later.
        await prisma.refund.updateMany({
            where: { id: row.id, status: "PENDING" },
            data: {
                failureReason: `Outcome unknown, awaiting reconciliation: ${message}`.slice(0, 500),
            },
        });

        logError("refund.outcome_unknown", new Error(message), {
            orderId: row.orderId,
            refundId: row.id,
            alert: true,
        });

        return outcomeFromRow(await loadRow(row.id));
    }

    try {
        await applyRazorpayState(row.id, remote);
    } catch (error) {
        // Razorpay accepted it; only our bookkeeping failed. The row stays
        // PENDING (reservation held) and reconciliation will find it.
        logError("refund.record_failed_after_success", error, {
            orderId: row.orderId,
            refundId: row.id,
            razorpayRefundId: remote.id,
            alert: true,
        });

        return {
            status: "PENDING",
            refundId: row.id,
            amount: row.amount.toFixed(2),
            razorpayRefundId: remote.id,
            reason: "Refund accepted by Razorpay and awaiting settlement",
        };
    }

    const settled = await loadRow(row.id);

    logInfo("refund.submitted", {
        orderId: row.orderId,
        refundId: row.id,
        status: settled.status,
    });

    return outcomeFromRow(settled);
}

// ============================================================
// RESERVE: order's own payment
// ============================================================

type Reservation =
    | { kind: "SKIP"; reason: string }
    | { kind: "EXISTING"; row: RefundRow }
    | { kind: "RESERVED"; row: RefundRow };

async function findByKey(orderId: number, idempotencyKey: string) {
    return (await prisma.refund.findUnique({
        where: { orderId_idempotencyKey: { orderId, idempotencyKey } },
    })) as RefundRow | null;
}

async function reserveOrderRefund(
    orderId: number,
    idempotencyKey: string,
    reason?: string
): Promise<Reservation> {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.refund.findUnique({
            where: { orderId_idempotencyKey: { orderId, idempotencyKey } },
        });

        if (existing) {
            return { kind: "EXISTING", row: existing as RefundRow };
        }

        const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
                paymentMethod: true,
                paymentStatus: true,
                razorpayPaymentId: true,
                total: true,
                cancelledAmount: true,
                returnedAmount: true,
                refundedAmount: true,
            },
        });

        if (!order) {
            return { kind: "SKIP", reason: "Order not found" };
        }

        if (order.paymentMethod !== "ONLINE") {
            return { kind: "SKIP", reason: "Order was not paid online" };
        }

        if (order.paymentStatus !== "PAID") {
            return { kind: "SKIP", reason: "Order was never paid" };
        }

        if (!order.razorpayPaymentId) {
            return {
                kind: "SKIP",
                reason: "Order has no Razorpay payment to refund",
            };
        }

        const outstanding = refundableAmount(order).sub(
            order.refundedAmount
        );

        if (outstanding.lte(ZERO)) {
            return { kind: "SKIP", reason: "Nothing outstanding to refund" };
        }

        // Optimistic lock on refundedAmount: a concurrent reservation
        // makes this match nothing.
        const claimed = await tx.order.updateMany({
            where: { id: orderId, refundedAmount: order.refundedAmount },
            data: { refundedAmount: { increment: outstanding } },
        });

        if (claimed.count === 0) {
            return {
                kind: "SKIP",
                reason: "Another refund claimed this amount first",
            };
        }

        const row = await tx.refund.create({
            data: {
                orderId,
                amount: outstanding,
                razorpayPaymentId: order.razorpayPaymentId,
                reason,
                idempotencyKey,
            },
        });

        return { kind: "RESERVED", row: row as RefundRow };
    });
}

async function runReservation(
    reserve: () => Promise<Reservation>,
    orderId: number,
    idempotencyKey: string
): Promise<RefundOutcome> {
    let reservation: Reservation;

    try {
        reservation = await reserve();
    } catch (error) {
        const existing =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
                ? await findByKey(orderId, idempotencyKey)
                : null;

        if (!existing) {
            throw error;
        }

        reservation = { kind: "EXISTING", row: existing };
    }

    if (reservation.kind === "SKIP") {
        return { status: "SKIPPED", reason: reservation.reason };
    }

    if (reservation.kind === "EXISTING") {
        return outcomeFromRow(reservation.row);
    }

    return submitToRazorpay(reservation.row);
}

export async function issueRefundForOrder(
    orderId: number,
    idempotencyKey: string,
    reason?: string
): Promise<RefundOutcome> {
    return runReservation(
        () => reserveOrderRefund(orderId, idempotencyKey, reason),
        orderId,
        idempotencyKey
    );
}

// ============================================================
// RESERVE: a payment the order never accepted ("orphan")
// ============================================================

/**
 * Refunds a captured payment in full when the order it belongs to could
 * not accept it (cancelled/expired before capture, or a duplicate
 * payment). At most one PENDING/PROCESSED refund exists per payment.
 */
export async function issueOrphanPaymentRefund(params: {
    orderId: number;
    razorpayPaymentId: string;
    amountInPaise: number;
    idempotencyKey: string;
    reason: string;
}): Promise<RefundOutcome> {
    const { orderId, razorpayPaymentId, amountInPaise, idempotencyKey } =
        params;

    return runReservation(
        () =>
            prisma.$transaction(
                async (tx): Promise<Reservation> => {
                    const existing = await tx.refund.findUnique({
                        where: {
                            orderId_idempotencyKey: { orderId, idempotencyKey },
                        },
                    });

                    if (existing) {
                        return { kind: "EXISTING", row: existing as RefundRow };
                    }

                    const live = await tx.refund.findFirst({
                        where: {
                            razorpayPaymentId,
                            status: { in: ["PENDING", "PROCESSED"] },
                        },
                    });

                    if (live) {
                        return {
                            kind: "SKIP",
                            reason: `Payment ${razorpayPaymentId} already has refund ${live.id} (${live.status})`,
                        };
                    }

                    const row = await tx.refund.create({
                        data: {
                            orderId,
                            amount: new Prisma.Decimal(amountInPaise)
                                .div(100)
                                .toDecimalPlaces(2),
                            razorpayPaymentId,
                            reason: params.reason,
                            idempotencyKey,
                            orphanPayment: true,
                        },
                    });

                    return { kind: "RESERVED", row: row as RefundRow };
                },
                { isolationLevel: "Serializable" }
            ),
        orderId,
        idempotencyKey
    );
}

// ============================================================
// CANCELLATION HOOK
// ============================================================

export async function issueRefundAfterCancellation(
    orderId: number,
    cancellationIdempotencyKey: string,
    reason?: string
): Promise<RefundOutcome | null> {
    try {
        return await issueRefundForOrder(
            orderId,
            `cancel:${cancellationIdempotencyKey}`,
            reason
        );
    } catch (error) {
        // The worker re-issues anything still owed.
        logError("refund.issue_error", error, { orderId, alert: true });

        return null;
    }
}

// ============================================================
// RETURNS SETTLEMENT
// ============================================================

/**
 * Promotes RECEIVED returns of an online-paid order to REFUNDED once
 * Razorpay has processed refunds covering everything owed on the order.
 */
export async function settleReturnsForOrder(orderId: number) {
    const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
            paymentMethod: true,
            total: true,
            cancelledAmount: true,
            returnedAmount: true,
        },
    });

    if (order.paymentMethod !== "ONLINE") {
        return;
    }

    const processed = await prisma.refund.aggregate({
        where: { orderId, status: "PROCESSED", orphanPayment: false },
        _sum: { amount: true },
    });

    const settled = (processed._sum.amount ?? new Prisma.Decimal(0)).gte(
        refundableAmount(order)
    );

    if (!settled) {
        return;
    }

    await prisma.returnRequest.updateMany({
        where: { orderId, status: "RECEIVED" },
        data: { status: "REFUNDED", refundedAt: new Date() },
    });
}

// ============================================================
// RECONCILE
// ============================================================

type RemoteRefund = {
    id: string;
    status?: string;
    notes?: Record<string, unknown> | unknown[];
};

/**
 * Settles one PENDING row from Razorpay's own list of refunds for the
 * payment. Returns the row's outcome afterwards.
 */
export async function reconcileRefund(
    refundId: number
): Promise<RefundOutcome> {
    const row = await loadRow(refundId);

    if (row.status !== "PENDING") {
        return outcomeFromRow(row);
    }

    const list = (await razorpay.payments.fetchMultipleRefund(
        row.razorpayPaymentId,
        { count: 100 }
    )) as { items?: RemoteRefund[] };

    const match = (list.items ?? []).find((remote) => {
        const notes =
            remote.notes && !Array.isArray(remote.notes)
                ? remote.notes
                : {};

        return (
            (row.razorpayRefundId !== null &&
                remote.id === row.razorpayRefundId) ||
            String(notes.refundId ?? "") === String(row.id)
        );
    });

    if (match) {
        await applyRazorpayState(row.id, match);
    } else if (
        row.razorpayRefundId === null &&
        Date.now() - row.createdAt.getTime() >= ASSUME_NOT_CREATED_AFTER_MS
    ) {
        await markRefundFailed(
            row.id,
            "Refund was never created at Razorpay"
        );
    }

    return outcomeFromRow(await loadRow(row.id));
}

// ============================================================
// WORKER
// ============================================================

const nextAttemptDue = (
    now: Date,
    attempts: number,
    lastFailure: Date | null
) =>
    lastFailure === null ||
    now.getTime() - lastFailure.getTime() >=
        RETRY_BASE_DELAY_MS * 2 ** Math.max(attempts - 1, 0);

export async function processRefunds(
    options: { now?: Date; intervalMs?: number } = {}
) {
    const now = options.now ?? new Date();
    const intervalMs = options.intervalMs ?? RETRY_BASE_DELAY_MS;
    const stats = { reconciled: 0, retried: 0, deadLettered: 0, errors: 0 };

    // 1. Settle uncertain rows.
    const pending = await prisma.refund.findMany({
        where: {
            status: "PENDING",
            createdAt: { lte: new Date(now.getTime() - RECONCILE_AFTER_MS) },
        },
        select: { id: true, orderId: true },
        orderBy: { createdAt: "asc" },
        take: 50,
    });

    for (const { id, orderId } of pending) {
        try {
            await reconcileRefund(id);
            stats.reconciled++;
        } catch (error) {
            stats.errors++;
            logError("refund.reconcile_failed", error, {
                refundId: id,
                orderId,
            });
        }
    }

    // 2. Money still owed on the order's own payment, nothing in flight.
    const owed = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT o."id"
          FROM "Order" o
         WHERE o."paymentMethod" = 'ONLINE'
           AND o."paymentStatus" = 'PAID'
           AND o."razorpayPaymentId" IS NOT NULL
           AND LEAST(o."cancelledAmount" + o."returnedAmount", o."total") > o."refundedAmount"
           AND o."updatedAt" <= ${new Date(now.getTime() - RECONCILE_AFTER_MS)}
           AND NOT EXISTS (
                SELECT 1 FROM "Refund" r
                 WHERE r."orderId" = o."id"
                   AND r."status" = 'PENDING'
                   AND NOT r."orphanPayment")
         ORDER BY o."id"
         LIMIT 50
    `;

    for (const { id: orderId } of owed) {
        const failures = await prisma.refund.findMany({
            where: { orderId, orphanPayment: false, status: "FAILED" },
            select: { updatedAt: true },
            orderBy: { updatedAt: "desc" },
        });

        const attempts = failures.length;
        const lastFailure = failures[0]?.updatedAt ?? null;

        if (attempts >= MAX_AUTO_ATTEMPTS) {
            if (
                lastFailure &&
                now.getTime() - lastFailure.getTime() < 2 * intervalMs
            ) {
                stats.deadLettered++;
                logError(
                    "refund.dead_letter",
                    new Error(
                        `Refund for order ${orderId} failed ${attempts} times; manual action required`
                    ),
                    { orderId, attempts, alert: true }
                );
            }
            continue;
        }

        if (!nextAttemptDue(now, attempts, lastFailure)) {
            continue;
        }

        try {
            await issueRefundForOrder(
                orderId,
                `auto-retry:${orderId}:${attempts + 1}`,
                "Automatic refund retry"
            );
            stats.retried++;
        } catch (error) {
            stats.errors++;
            logError("refund.retry_failed", error, { orderId });
        }
    }

    // 3. Returns whose refunds have all settled.
    const receivedReturns = await prisma.returnRequest.findMany({
        where: { status: "RECEIVED" },
        select: { orderId: true },
        distinct: ["orderId"],
        take: 100,
    });

    for (const { orderId } of receivedReturns) {
        await settleReturnsForOrder(orderId).catch((error) =>
            logError("refund.settle_returns_failed", error, { orderId })
        );
    }

    // 4. Orphan payments whose every refund attempt failed.
    const orphans = await prisma.$queryRaw<
        Array<{
            orderId: number;
            razorpayPaymentId: string;
            amount: Prisma.Decimal;
            attempts: number;
            lastFailure: Date;
        }>
    >`
        SELECT r."orderId", r."razorpayPaymentId",
               MAX(r."amount") AS amount,
               COUNT(*)::int AS attempts,
               MAX(r."updatedAt") AS "lastFailure"
          FROM "Refund" r
         WHERE r."orphanPayment"
         GROUP BY r."orderId", r."razorpayPaymentId"
        HAVING BOOL_AND(r."status" = 'FAILED')
         LIMIT 50
    `;

    for (const orphan of orphans) {
        if (orphan.attempts >= MAX_AUTO_ATTEMPTS) {
            if (
                now.getTime() - orphan.lastFailure.getTime() <
                2 * intervalMs
            ) {
                stats.deadLettered++;
                logError(
                    "refund.dead_letter",
                    new Error(
                        `Refund of payment ${orphan.razorpayPaymentId} failed ${orphan.attempts} times; manual action required`
                    ),
                    { orderId: orphan.orderId, alert: true }
                );
            }
            continue;
        }

        if (!nextAttemptDue(now, orphan.attempts, orphan.lastFailure)) {
            continue;
        }

        try {
            await issueOrphanPaymentRefund({
                orderId: orphan.orderId,
                razorpayPaymentId: orphan.razorpayPaymentId,
                amountInPaise: toPaise(new Prisma.Decimal(orphan.amount)),
                idempotencyKey: `webhook-orphan:${orphan.razorpayPaymentId}:retry-${orphan.attempts}`,
                reason: "Automatic refund retry",
            });
            stats.retried++;
        } catch (error) {
            stats.errors++;
            logError("refund.retry_failed", error, {
                orderId: orphan.orderId,
            });
        }
    }

    return stats;
}

let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

export function startRefundWorker(intervalMs = RETRY_BASE_DELAY_MS) {
    if (workerTimer) {
        return;
    }

    const tick = async () => {
        if (workerRunning) {
            return;
        }

        workerRunning = true;

        try {
            const stats = await processRefunds({ intervalMs });

            if (stats.reconciled + stats.retried + stats.deadLettered > 0) {
                logInfo("refund_worker.tick", stats);
            }
        } catch (error) {
            logError("refund_worker.failed", error, { alert: true });
        } finally {
            workerRunning = false;
        }
    };

    workerTimer = setInterval(tick, intervalMs);
    workerTimer.unref();
    void tick();
}

export function stopRefundWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}

// ============================================================
// ADMIN QUERIES
// ============================================================

export const REFUND_PUBLIC_SELECT = {
    id: true,
    amount: true,
    status: true,
    reason: true,
    failureReason: true,
    razorpayRefundId: true,
    orphanPayment: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.RefundSelect;

export async function listRefunds(params: {
    status?: "PENDING" | "PROCESSED" | "FAILED";
    page: number;
    limit: number;
}) {
    const where: Prisma.RefundWhereInput = params.status
        ? { status: params.status }
        : {};

    const [refunds, total] = await prisma.$transaction([
        prisma.refund.findMany({
            where,
            select: {
                ...REFUND_PUBLIC_SELECT,
                orderId: true,
                idempotencyKey: true,
            },
            orderBy: { updatedAt: "desc" },
            skip: (params.page - 1) * params.limit,
            take: params.limit,
        }),
        prisma.refund.count({ where }),
    ]);

    const totalPages = Math.max(Math.ceil(total / params.limit), 1);

    return {
        refunds,
        pagination: {
            page: params.page,
            limit: params.limit,
            total,
            totalPages,
            hasNextPage: params.page < totalPages,
            hasPreviousPage: params.page > 1,
        },
    };
}

/**
 * Admin "retry": re-issues a FAILED refund's money under a new key. For
 * the order's own payment this is the ordinary outstanding computation;
 * for an orphan payment it refunds that payment again.
 */
export async function retryRefund(
    refundId: number,
    idempotencyKey: string
): Promise<RefundOutcome> {
    const row = await loadRow(refundId);

    if (row.status === "PENDING") {
        return reconcileRefund(refundId);
    }

    if (row.status === "PROCESSED") {
        return { status: "SKIPPED", reason: "Refund already processed" };
    }

    if (row.orphanPayment) {
        return issueOrphanPaymentRefund({
            orderId: row.orderId,
            razorpayPaymentId: row.razorpayPaymentId,
            amountInPaise: toPaise(row.amount),
            idempotencyKey: `admin-retry:${idempotencyKey}`,
            reason: "Manual refund retry",
        });
    }

    return issueRefundForOrder(
        row.orderId,
        `admin-retry:${idempotencyKey}`,
        "Manual refund retry"
    );
}
