import prisma from "../config/prisma";
import razorpay from "../config/razorpay";
import { Prisma } from "../../generated/prisma/client";

const ZERO = new Prisma.Decimal(0);

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
          status: "FAILED";
          refundId: number;
          amount: string;
          failureReason: string;
      };

// ============================================================
// PAISE
// ============================================================

function toPaise(
    amount: Prisma.Decimal
): number {
    return amount
        .mul(100)
        .toDecimalPlaces(0)
        .toNumber();
}

function describeError(
    error: unknown
): string {
    if (
        error &&
        typeof error === "object" &&
        "error" in error
    ) {
        const inner = (
            error as {
                error?: {
                    description?: string;
                    code?: string;
                };
            }
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

// ============================================================
// RESERVATION
// ============================================================

type Reservation =
    | {
          kind: "SKIP";
          reason: string;
      }
    | {
          kind: "EXISTING";
          refund: {
              id: number;
              amount: Prisma.Decimal;
              status: string;
              razorpayRefundId: string | null;
              failureReason: string | null;
          };
      }
    | {
          kind: "RESERVED";
          refundId: number;
          amount: Prisma.Decimal;
          razorpayPaymentId: string;
      };

async function reserveRefund(
    orderId: number,
    idempotencyKey: string,
    reason?: string
): Promise<Reservation> {
    return prisma.$transaction(
        async (tx) => {
            const existing =
                await tx.refund.findUnique({
                    where: {
                        orderId_idempotencyKey:
                            {
                                orderId,

                                idempotencyKey,
                            },
                    },
                });

            if (existing) {
                return {
                    kind: "EXISTING",
                    refund: existing,
                };
            }

            const order =
                await tx.order.findUnique({
                    where: {
                        id: orderId,
                    },

                    select: {
                        paymentMethod: true,
                        paymentStatus: true,
                        razorpayPaymentId: true,
                        total: true,
                        cancelledAmount: true,
                        refundedAmount: true,
                    },
                });

            if (!order) {
                return {
                    kind: "SKIP",
                    reason: "Order not found",
                };
            }

            if (
                order.paymentMethod !==
                "ONLINE"
            ) {
                return {
                    kind: "SKIP",
                    reason: "Order was not paid online",
                };
            }

            if (
                order.paymentStatus !== "PAID"
            ) {
                return {
                    kind: "SKIP",
                    reason: "Order was never paid",
                };
            }

            if (!order.razorpayPaymentId) {
                return {
                    kind: "SKIP",
                    reason: "Order has no Razorpay payment to refund",
                };
            }

            const owed = Prisma.Decimal.min(
                order.cancelledAmount,
                order.total
            );

            const outstanding = owed.sub(
                order.refundedAmount
            );

            if (outstanding.lte(ZERO)) {
                return {
                    kind: "SKIP",
                    reason: "Nothing outstanding to refund",
                };
            }

            const claimed =
                await tx.order.updateMany({
                    where: {
                        id: orderId,

                        refundedAmount:
                            order.refundedAmount,
                    },

                    data: {
                        refundedAmount: {
                            increment:
                                outstanding,
                        },
                    },
                });

            if (claimed.count === 0) {
                return {
                    kind: "SKIP",
                    reason: "Another refund claimed this amount first",
                };
            }

            const refund =
                await tx.refund.create({
                    data: {
                        orderId,

                        amount: outstanding,

                        razorpayPaymentId:
                            order.razorpayPaymentId,

                        reason,

                        idempotencyKey,
                    },
                });

            return {
                kind: "RESERVED",
                refundId: refund.id,
                amount: outstanding,

                razorpayPaymentId:
                    order.razorpayPaymentId,
            };
        }
    );
}

async function releaseReservation(
    orderId: number,
    refundId: number,
    amount: Prisma.Decimal,
    failureReason: string
): Promise<void> {
    await prisma.$transaction(
        async (tx) => {
            await tx.refund.update({
                where: {
                    id: refundId,
                },

                data: {
                    status: "FAILED",

                    failureReason:
                        failureReason.slice(
                            0,
                            500
                        ),
                },
            });

            await tx.order.updateMany({
                where: {
                    id: orderId,

                    refundedAmount: {
                        gte: amount,
                    },
                },

                data: {
                    refundedAmount: {
                        decrement: amount,
                    },
                },
            });
        }
    );
}

// ============================================================
// ISSUE REFUND
// ============================================================

export async function issueRefundForOrder(
    orderId: number,
    idempotencyKey: string,
    reason?: string
): Promise<RefundOutcome> {
    let reservation: Reservation;

    try {
        reservation = await reserveRefund(
            orderId,
            idempotencyKey,
            reason
        );
    } catch (error) {
        if (
            error instanceof
                Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            const existing =
                await prisma.refund.findUnique({
                    where: {
                        orderId_idempotencyKey:
                            {
                                orderId,

                                idempotencyKey,
                            },
                    },
                });

            if (existing) {
                reservation = {
                    kind: "EXISTING",
                    refund: existing,
                };
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    }

    if (reservation.kind === "SKIP") {
        return {
            status: "SKIPPED",
            reason: reservation.reason,
        };
    }

    if (reservation.kind === "EXISTING") {
        const { refund } = reservation;

        if (
            refund.status === "PROCESSED" &&
            refund.razorpayRefundId
        ) {
            return {
                status: "PROCESSED",
                refundId: refund.id,

                amount: refund.amount.toFixed(
                    2
                ),

                razorpayRefundId:
                    refund.razorpayRefundId,
            };
        }

        if (refund.status === "FAILED") {
            return {
                status: "FAILED",
                refundId: refund.id,

                amount: refund.amount.toFixed(
                    2
                ),

                failureReason:
                    refund.failureReason ??
                    "Refund failed; retry with a new idempotency key",
            };
        }

        return {
            status: "SKIPPED",

            reason: `Refund ${refund.id} for this request is unresolved; reconcile it with Razorpay before retrying`,
        };
    }

    const {
        refundId,
        amount,
        razorpayPaymentId,
    } = reservation;

    try {
        const razorpayRefund =
            await razorpay.payments.refund(
                razorpayPaymentId,
                {
                    amount: toPaise(amount),

                    speed: "normal",

                    receipt: idempotencyKey,

                    notes: {
                        orderId:
                            String(orderId),

                        refundId:
                            String(refundId),
                    },
                }
            );

        await prisma.refund.update({
            where: {
                id: refundId,
            },

            data: {
                status: "PROCESSED",

                razorpayRefundId:
                    razorpayRefund.id,
            },
        });

        return {
            status: "PROCESSED",
            refundId,

            amount: amount.toFixed(2),

            razorpayRefundId:
                razorpayRefund.id,
        };
    } catch (error) {
        const failureReason =
            describeError(error);

        await releaseReservation(
            orderId,
            refundId,
            amount,
            failureReason
        );

        return {
            status: "FAILED",
            refundId,

            amount: amount.toFixed(2),

            failureReason,
        };
    }
}

export async function issueRefundAfterCancellation(
    orderId: number,
    cancellationIdempotencyKey: string,
    reason?: string
): Promise<RefundOutcome | null> {
    try {
        const outcome =
            await issueRefundForOrder(
                orderId,

                `cancel:${cancellationIdempotencyKey}`,

                reason
            );

        if (outcome.status === "FAILED") {
            console.error(
                `REFUND FAILED: order ${orderId} — ${outcome.failureReason}`
            );
        }

        return outcome;
    } catch (error) {
        console.error(
            `REFUND ERROR: order ${orderId} —`,
            error
        );

        return null;
    }
}
