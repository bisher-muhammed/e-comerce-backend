/*
 * Admin permissions (audit M9). SUPER_ADMIN holds every permission
 * implicitly (and alone manages admins); an ADMIN holds exactly what is in
 * User.permissions, granted by a SUPER_ADMIN.
 */
export const PERMISSIONS = {
  "orders.read": "View orders, refunds and returns",
  "orders.update": "Move orders through fulfilment (confirm, ship, deliver)",
  "orders.cancel": "Cancel orders (triggers refunds of paid orders)",
  "orders.refund": "Issue, retry and reconcile refunds",
  "returns.manage": "Approve, reject and receive returns (receiving refunds them)",
  "catalog.read": "View products, categories, colours, sizes and stock history",
  "catalog.write": "Create and edit products, prices, categories, colours and sizes",
  "stock.write": "Restock and adjust stock",
  "coupons.read": "View coupons",
  "coupons.write": "Create and change coupons",
  "offers.read": "View offers",
  "offers.write": "Create and change offers",
  "customers.read": "View customers and their personal data",
  "customers.suspend": "Suspend and reactivate customers",
  "stats.view": "View sales statistics",
  "audit.view": "View the admin audit log",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const isPermission = (value: string): value is Permission =>
  value in PERMISSIONS;

/*
 * What a newly created ADMIN starts with: day-to-day fulfilment and
 * catalogue work. Money-moving and account-affecting powers (refunds,
 * cancellations, coupons, offers, stock adjustments, suspensions, audit
 * log) must be granted explicitly. Existing admins were migrated with every
 * permission so a deploy changes nobody's access.
 */
export const DEFAULT_ADMIN_PERMISSIONS: Permission[] = [
  "orders.read",
  "orders.update",
  "returns.manage",
  "catalog.read",
  "catalog.write",
  "coupons.read",
  "offers.read",
  "customers.read",
  "stats.view",
];

export const hasPermission = (
  user: { role: string; permissions?: string[] | null },
  permission: Permission
) =>
  user.role === "SUPER_ADMIN" ||
  (user.role === "ADMIN" && (user.permissions ?? []).includes(permission));
