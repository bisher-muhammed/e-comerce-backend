# Backend Audit — `e-comerce-backend`

**Audited commit:** `d3a13a2` · **Size:** ~12,300 LOC across 84 TypeScript files
**Stack:** Express 5.2 · Prisma 7.9 · PostgreSQL 17 · Redis · Razorpay · Cloudinary · argon2 · zod 4

> The repo moved during this audit (7,131 → 12,311 LOC, adding coupons, admin order/customer management, and a refresh-token flow). **Every line reference below is verified against `d3a13a2`.**

---

## 0. Blockers — broken right now
## 1. CRITICAL
## 2. HIGH
## 3. MEDIUM
## 4. LOW

## 5. Verified correct — do not "fix" these

This codebase gets several genuinely hard things right. Changing them would be a regression.

- **Razorpay signature verification is textbook.** HMAC-SHA256 over `order_id|payment_id`, and it uses `crypto.timingSafeEqual` with a length pre-check — not `===`.
- **Order amounts are recomputed server-side** inside the transaction from DB prices. The client never sends a price or total. Tampering is impossible.
- **Zero customer-scoped IDORs.** Every address, cart item, wishlist entry, order, order item, coupon claim, and payment verification is scoped by `userId` or an ownership check. I looked specifically for this and found none.
- **Every admin route is guarded** by both `authenticate` and `authorize`. `authenticate` re-reads `role`/`status` from the DB rather than trusting the JWT claim, so a suspended account is rejected instantly. `createAdmin` hardcodes `role: "ADMIN"`, so a SUPER_ADMIN cannot mint another through the API.
- **Stock decrement is oversell-safe** — a conditional `updateMany({ where: { stock: { gte: quantity } } })` with a count assertion, not read-then-write. Two concurrent checkouts cannot oversell.
- **Cancel-twice does not double-restock** — `@@unique([orderItemId, idempotencyKey])` on `OrderItemAction`, with correct P2002 handling.
- **Razorpay and Cloudinary are called outside transactions** — explicitly commented and correctly done.
- **Idempotency is backed by a real unique constraint** with correct P2002 → re-fetch handling.
- **No SQL injection.** Only two raw queries exist, both parameterised tagged templates. No `$queryRawUnsafe` anywhere.
- **No mass assignment.** Every Prisma payload is field-mapped; `req.files` is never spread; zod's `z.object()` strips unknown keys.
- **Coupon rules are re-validated inside the checkout transaction** — expiry, active flag, and minimum order are re-read from the DB, not trusted from the earlier preview call. Discount is clamped so the total can't go negative at checkout.
- **OTP uses `crypto.randomInt`**, is argon2-hashed before storage, has a 120s TTL, and is never returned in an API response. Login is uniformly "Invalid email or password" — no user enumeration.
- **No hardcoded secrets**, and **`.env` has never been committed** — verified four ways across all branches and full history.
- **Nearly every FK and filter column is already indexed.** I expected gaps here and was wrong.
- **Read-side queries are not N+1** — the nested `include` trees are single batched Prisma calls.
- **`tsconfig.json` has `strict: true`.**

---

## 6. Suggested order of work

**Now — unblock:**
1. `npx prisma migrate deploy && npx prisma generate` (B1)
2. Delete the `node:stream/iter` import (B2)
3. Fix the admin-cancel `idempotencyKey` — one line (C1)

**This week — money and inventory correctness:**
4. Delete the duplicate `verifyPayment` (C3)
5. Fix the negative-total arithmetic (C2)
6. Write the expired-order sweeper (C4) — the transaction body already exists

**Then — security hardening:**
8. `app.use(helmet())` and `express-rate-limit` (M1, H1) — an afternoon, very high value
10. Strip token/OTP logging (M3)
11. Generic production error messages (M2)

**Then — performance:**
13. Paginate the product listings (C5) + add `compression` (M9) — the two cheapest large wins
14. Set the connection pool `max` (M7) and add graceful shutdown (M8)

**Ongoing:** Razorpay webhook (M5), Redis caching (M18).

---

## 7. Confidence notes

- **Executed and verified:** `npx tsc --noEmit`, `npx prisma migrate status`, the `psql` table query, `node -e "require('node:stream/iter')"`, `npm audit`, and the git-history secret sweep. B1, B2, and H7 are reproduced facts.
- **Verified by reading the exact source:** C1, C2, C3, C4, C5, H1, H5, H6, M1, M2, M3. I opened each cited line and confirmed the quoted code.
- **Read from source, not executed:** the remaining MEDIUM/LOW items. The reasoning is traced through real code, but no integration test was run against them.
- **Not assessed:** production deployment config, infrastructure, load behaviour under real traffic, and whether `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` differ in your deployed environment (M12's severity depends on that).
