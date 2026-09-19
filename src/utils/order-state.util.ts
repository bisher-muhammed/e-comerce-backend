/*
 * Order state machine (audit M1).
 *
 * Status transitions depend on how and whether the order was paid:
 *
 *   PENDING ─▶ CONFIRMED ─▶ SHIPPED ─▶ DELIVERED
 *      │           │           │
 *      └───────────┴───────────┴──▶ CANCELLED
 *
 * - An ONLINE order is confirmed only by its payment (verify/webhook). An
 *   admin may not confirm, ship or deliver it while it is unpaid — goods
 *   would leave without money, and a later capture would look "lost".
 * - A COD order is paid on delivery, so it may move forward unpaid.
 * - Cancellation is allowed until delivery.
 */
import { OrderStatus } from "../../generated/prisma/enums";

type PaymentMethod = "COD" | "ONLINE";
type PaymentStatus = "PENDING" | "PAID" | "FAILED";

export interface OrderStateInput {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
}

const FORWARD: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ],
  SHIPPED: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

const REQUIRES_ONLINE_PAYMENT = new Set<OrderStatus>([
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
]);

export const isUnpaidOnline = (order: OrderStateInput) =>
  order.paymentMethod === "ONLINE" && order.paymentStatus !== "PAID";

/** Statuses an admin may move this order to right now. */
export const allowedNextStatuses = (
  order: OrderStateInput
): OrderStatus[] =>
  FORWARD[order.status].filter(
    (next) =>
      !(isUnpaidOnline(order) && REQUIRES_ONLINE_PAYMENT.has(next))
  );

/** Throws a user-facing message unless the transition is allowed. */
export const transitionError = (
  order: OrderStateInput,
  next: OrderStatus
): string | null => {
  if (allowedNextStatuses(order).includes(next)) {
    return null;
  }

  if (FORWARD[order.status].length === 0) {
    return `Order is already in a terminal state (${order.status}) and cannot be changed`;
  }

  if (
    FORWARD[order.status].includes(next) &&
    isUnpaidOnline(order)
  ) {
    return `This online order has not been paid; it cannot be moved to ${next} until payment is received`;
  }

  const allowed = allowedNextStatuses(order);

  return `Cannot move order from ${order.status} to ${next}. Allowed next statuses: ${allowed.join(", ") || "none"}`;
};
