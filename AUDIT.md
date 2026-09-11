# Backend Audit — `e-comerce-backend`

**Audited commit:** `d3a13a2` · **Size:** ~12,300 LOC across 84 TypeScript files
**Stack:** Express 5.2 · Prisma 7.9 · PostgreSQL 17 · Redis · Razorpay · Cloudinary · argon2 · zod 4

> The repo moved during this audit (7,131 → 12,311 LOC, adding coupons, admin order/customer management, and a refresh-token flow). **Every line reference below is verified against `d3a13a2`.**

---

## 0. Blockers — broken right now
## 1. CRITICAL
## 2. HIGH

### H2. OTP brute force → email-verification bypass / account pre-hijacking

[`verify.service.ts:42-53`](src/services/auth/verify.service.ts#L42-L53)

```ts
const isValidOtp = await argon2.verify(otpHash, otp);
if (!isValidOtp) {
  throw new AppError("Invalid verification code", 400);
}
```

The OTP key is **not deleted on failure** and **no attempt counter is incremented**. `/auth/resend-otp` can be called without limit, each call minting a fresh OTP with a fresh 120s window.

**Exploit:**
1. Attacker registers with the **victim's email** and the attacker's password. The API returns the `registrationToken` to the attacker ([`auth.controller.ts:23`](src/controllers/auth.controller.ts#L23)); the OTP goes to the victim's inbox.
2. Attacker hammers `/auth/verify-otp`. The space is 10⁶, argon2 is only a soft throttle, and unlimited resends give unlimited fresh windows. Sustained parallel guessing succeeds in hours.
3. [`verify.service.ts:73-97`](src/services/auth/verify.service.ts#L73-L97) creates the user `ACTIVE` with the **attacker's** password hash on the **victim's** email.

Secondary: hammering `argon2.verify` saturates the libuv threadpool — an application-layer DoS by itself.

**Fix:** Redis counter keyed on the registration token (and per-IP); delete the OTP and hard-fail after 5 attempts; cap resends to ~3 with a 60s cooldown; rate-limit `/auth/*`.

### H3. Coupons: no usage limit exists, claims are burned and never released

**No global limit is possible.** [`schema.prisma:370-393`](prisma/schema.prisma#L370-L393) — `Coupon` has no `usageLimit`, `usedCount`, `perUserLimit`, or `maxRedemptions`. The only cap is an implicit one-per-user from `@@unique([couponId, userId])`. "FLAT500, first 100 customers" is unimplementable; a budget-capped campaign has no server-side stop.

**Claims are consumed before payment.** [`checkout.service.ts:829-839`](src/services/customer/checkout.service.ts#L829-L839) sets `usedAt` at PENDING-order creation. Three leaks follow:
- Customer abandons the Razorpay modal → no sweeper exists (C4) → coupon burned forever.
- Razorpay order creation fails → the rollback releases stock but **never touches `couponClaim`**.
- Cancellation never releases it either — `grep -rn "couponClaim" src/` shows the only writers are `checkout.service.ts:658` and `:830`.

Because of the unique constraint the customer cannot re-claim, and `deleteCoupon` refuses to delete a claimed coupon ([`admin/coupon.service.ts:637-643`](src/services/admin/coupon.service.ts#L637-L643)) — **no admin remedy exists**.

**Redemption is a read-then-write.** [`checkout.service.ts:236-262`](src/services/customer/checkout.service.ts#L236-L262) reads `claim.usedAt`; `:657` / `:829` later write it with no `WHERE usedAt IS NULL` guard. It survives concurrency only incidentally, because same-user checkouts serialize on the cart row lock. Add a second redemption path (buy-now, admin-placed order, retry) and the guard vanishes.

**Fix:** add `usageLimit`/`usedCount` consumed via conditional update; release the claim in the rollback, the sweeper, and every cancel path; make redemption `updateMany({ where: { id, usedAt: null } })` with a count assertion.

### H4. No refund is ever issued — anywhere

`grep -rn "refund" src/` → `refundedAmount` appears in two `select` blocks and one comment. It is **never written**. There is no `razorpay.payments.refund` call in the codebase.

A customer can cancel a `CONFIRMED`, `paymentStatus: PAID`, online-paid order ([`customer/order.service.ts:307-315`](src/services/customer/order.service.ts#L307-L315) permits `CONFIRMED`) and the money is simply never returned. `paymentStatus` stays `PAID` while `total` goes to 0.

Related: [`customer/order.service.ts:440-451`](src/services/customer/order.service.ts#L440-L451) increments `cancelledAmount` by the **gross** amount, not net of the coupon — so for a ₹1000 order with ₹200 discount (₹800 paid), `cancelledAmount` records **₹1000**. Any future refund driven off that field over-refunds ₹200 every time. It also zeroes `couponDiscount` while leaving `couponCode` set, destroying the record of what was actually charged.

**Fix:** treat `subtotal`/`total`/`couponDiscount` as an immutable snapshot; record cancellations in `cancelledAmount` net of the discount; issue the Razorpay refund gated on a conditional update so a retry cannot double-credit.

### H5. Refresh tokens are not rotated or revocable, and there is no logout

[`refresh.service.ts:11-52`](src/services/auth/refresh.service.ts#L11-L52) verifies the JWT and mints a new access token. It **never rotates** the refresh token and **never checks a server-side allowlist/denylist**. `grep -rn "clearCookie\|logout" src/` → **no match**: there is no logout endpoint at all.

A stolen refresh token is replayable until expiry and cannot be revoked — not by password change, not by the user, not by an admin (beyond flipping `status`, which does work).

**Good:** [`refresh.service.ts:17-39`](src/services/auth/refresh.service.ts#L17-L39) re-reads the user, rejects non-`ACTIVE`, and takes `role` from the **database** rather than the token claim. Preserve that.

**Fix:** per-token `jti` stored in Redis, rotate on every refresh, treat reuse of a consumed `jti` as theft and revoke the family; add `POST /auth/logout`.

### H6. Session dies hourly — refresh cookie TTL contradicts the token TTL

| Token | JWT lifetime | Cookie `maxAge` |
|---|---|---|
| access | 15m ([`jwt.ts:15`](src/utils/jwt.ts#L15)) | 15m ✓ |
| **refresh** | **55m** ([`jwt.ts:23`](src/utils/jwt.ts#L23)) | **7 days** ✗ |

The refresh JWT dies after 55 minutes while the browser holds the cookie for 7 days — users are hard logged out roughly hourly, and for the remaining ~7 days the browser keeps sending a token `/refresh-token` will always reject.

Also: `sameSite: "lax"` with no `path` scoping means the refresh token is transmitted on **every** API request rather than only to the refresh endpoint, widening the theft surface.

**Fix:** refresh TTL should comfortably exceed the access TTL (7d/15m is the usual pairing); add `path: "/api/v1/auth/refresh-token"`.

### H7. Dependency CVEs — 7 high severity

```
multer         high  DoS via crafted multipart field names   ← you accept uploads
nodemailer     high  resolveContent() bypasses disableFileAccess
qs             mod   array-limit bypass
fast-uri       high  host confusion via skipped IDN canonicalization
deepmerge-ts   high  stack exhaustion on recursive object graphs
@prisma/config high  (via deepmerge-ts)
mysql2         high  auth plugin downgrade (transitive; unused)
```

`npm audit fix` clears most. `multer` matters most given the upload surface.

### H8. Product save does 3N round trips inside one transaction

[`admin/product.service.ts:422-449`](src/services/admin/product.service.ts#L422-L449) and again at `:640-667`:

```ts
for (const color of resolvedColors) {
  const productColor = await tx.productColor.create({…});
  await tx.productImage.createMany({…});
  await tx.productVariant.createMany({…});
}
```

8 colours = 24 sequential round trips holding a transaction and a pooled connection. At 15ms RTT on a managed DB that's 360ms of connection-hold per save.

The same shape appears in the checkout stock loop ([`checkout.service.ts:212,284`](src/services/customer/checkout.service.ts#L212)) — N round trips **while holding a Serializable transaction and a `SELECT … FOR UPDATE` row lock on `Cart`**. The lock window scales linearly with cart size; this is the single biggest contributor to P2034 serialization failures and pool exhaustion under load. Cancellation paths do 3 queries per item (a 20-item order = 60 round trips).

**Fix:** `createManyAndReturn` for colours; one `UPDATE … FROM (VALUES …)` for the stock batch; `createMany` for the cancellation actions.

### H9. Order search does a full sequential scan

[`customer/order.service.ts:115`](src/services/customer/order.service.ts#L115)

```ts
{ items: { some: { productName: { contains: search, mode: "insensitive" } } } }
```

`ILIKE '%foo%'` cannot use a B-tree index, and `some` compiles to a correlated subquery → sequential scan of the entire `OrderItem` table on every keystroke. Admin order search ([`admin/order.service.ts:95-139`](src/services/admin/order.service.ts#L95-L139)) does four such scans at once.

**Fix:** `pg_trgm` + GIN indexes, or restrict search to indexed columns.

---

## 3. MEDIUM

| # | Finding | Location |
|---|---|---|
| M1 | **`helmet` installed but never mounted.** `package.json` lists it; `grep -rn "helmet" src/` → nothing. No HSTS, no `X-Content-Type-Options`, no frameguard, no CSP; `X-Powered-By: Express` still advertised. One line to fix. | [`app.ts`](src/app.ts) |
| M2 | **Error handler leaks internals.** Returns raw `error.message` for unexpected errors — Prisma messages carry model names, field names, constraint names. Combined with M4, an attacker can map your schema by feeding bad IDs. | [`error.middleware.ts:34-39`](src/middlewares/error.middleware.ts#L34-L39) |
| M3 | **Access tokens and plaintext OTPs written to logs.** `console.log("COOKIES:", req.cookies)` logs the raw JWT on **every authenticated request**; `register.service.ts:69` and `resend.service.ts:54` log the plaintext OTP; `authorize.middleware.ts:26-28` logs the full user object. Anyone with log access can impersonate any user. | [`auth.middleware.ts:15`](src/middlewares/auth.middleware.ts#L15) +4 |
| M4 | **`PATCH /admin/customers/:id/status` has zero body validation.** `const { status } = req.body` goes straight into `prisma.user.update`. A `listCustomersSchema` exists but no `updateCustomerStatusSchema`. Not privilege escalation (only `status` is written) but it's the one mutating route with no validation. | [`admin/customer.route.ts:36-41`](src/routes/admin/customer.route.ts#L36-L41) |
| M5 | **No Razorpay webhook.** `grep -rni "webhook" src/` → nothing. Payment state depends entirely on the browser calling back. User closes the tab after paying → money captured at Razorpay, order `PENDING` forever. No reconciliation for later refunds or disputes. | (missing) |
| M6 | **Payment accepted without confirming capture.** Signature is validated but `razorpay.payments.fetch()` is never called. If the account isn't on auto-capture, a payment can be `authorized` but never `captured` — signature still valid, DB records `PAID`, authorization voids in ~5 days. You ship for money never collected. | [`checkout.service.ts:1273`](src/services/customer/checkout.service.ts#L1273) |
| M7 | **Default 10-connection pool.** `new PrismaPg({ connectionString })` with no `max`. `pg.Pool` defaults to 10. Each checkout holds one for a Serializable transaction spanning N round trips (H8) — ~10 concurrent checkouts and everything else queues then fails with P2024. | [`config/prisma.ts:5-11`](src/config/prisma.ts#L5-L11) |
| M8 | **No graceful shutdown.** No `SIGTERM`/`SIGINT` handler, no `$disconnect()`, and `app.listen`'s return value isn't even captured. Rolling deploys kill in-flight transactions and orphan DB backends. | [`server.ts`](src/server.ts) |
| M9 | **No compression.** Not in `package.json`. Given C5's multi-MB payloads, gzip is the cheapest single win available. | [`app.ts`](src/app.ts) |
| M10 | **Uploads buffer ~1 GB in RAM.** `memoryStorage()` with `files: 200` × `fileSize: 5MB`, all held simultaneously then uploaded concurrently. Two concurrent admin requests OOM the process. MIME type is also taken from the client-supplied header with no magic-byte check. | [`upload.middleware.ts:16,42-45`](src/middlewares/upload.middleware.ts#L16) |
| M11 | **SMTP awaited inline during register/resend.** Response time = argon2 hash + 2 Redis writes + a full SMTP handshake (300ms–3s, unbounded). If SMTP fails the **registration fails entirely** despite the Redis session already being written — user gets a 500 and a dangling token. Transporter has no `pool: true`, so every OTP opens a fresh TCP+TLS+AUTH connection. | [`register.service.ts:66`](src/services/auth/register.service.ts#L66) |
| M12 | **JWT algorithm not pinned.** `jwt.verify(token, SECRET)` with no `{ algorithms: ["HS256"] }`, no issuer/audience. jsonwebtoken v9 rejects `alg: none`, so not directly exploitable — but access and refresh tokens carry an **identical payload shape with no `typ` claim**, separated only by the two secrets differing. Set them to the same value by accident and the tokens become interchangeable. | [`jwt.ts:30-33,39-42`](src/utils/jwt.ts#L30-L33) |
| M13 | **Money computed in JS floats.** Columns are `Decimal(10,2)` (correct), but `subtotal` and discount arithmetic uses `Number` + `toFixed(2)`. `Prisma.Decimal` is already used properly in `customer/order.service.ts:19-42`. Latent rather than demonstrated — no reproducible off-by-a-paisa case found — but free to remove. | [`checkout.service.ts:418-426`](src/services/customer/checkout.service.ts#L418-L426) |
| M14 | **`endDate` filter excludes the requested day.** `z.coerce.date()` on `"2026-01-15"` yields UTC midnight; with `lte`, every order placed that day is excluded. For IST users the window is additionally shifted 5h30m. | [`customer/order.validation.ts:23-24`](src/validations/customer/order.validation.ts#L23-L24) |
| M15 | **A FIXED coupon with no minimum makes any order free.** `minimumOrderAmount` defaults to 0 and the FIXED branch does `Math.min(discountValue, subtotal)`. "₹500 OFF" with no minimum → a ₹499 item costs **₹0**, and for COD the order is created `CONFIRMED` and ships. | [`admin/coupon.validation.ts:60`](src/validations/admin/coupon.validation.ts#L60) |
| M16 | **Cart has no price snapshot; totals computed twice.** `CartItem` stores only `quantity`, so `getCart` returns no total and the frontend sums it — while the server computes its own independently at checkout. If an admin edits a price in between, the displayed and charged amounts differ silently. `OrderItem` already snapshots correctly. | [`schema.prisma:195-214`](prisma/schema.prisma#L195-L214) |
| M17 | **`addToCart` is a 4-round-trip read-then-write with no transaction.** Stock is checked against a stale read; two concurrent adds both pass. Not an oversell (checkout catches it) but the user gets a cart that fails at payment. Hottest write endpoint in the app. | [`cart.service.ts:9-57`](src/services/customer/cart.service.ts#L9-L57) |
| M18 | **Redis caches nothing but OTPs.** All 11 call sites are in `config/redis.ts` and the three auth services. High-value targets: product listing/detail, categories, sizes, colours, and the per-request `User` lookup in `authenticate` (M19). Never cache `stock`. | — |
| M19 | **`authenticate` does a DB round trip on every request.** Correct for security (catches suspended accounts immediately) but the #1 caching candidate — a 60s TTL would cut it dramatically. | [`auth.middleware.ts:27-39`](src/middlewares/auth.middleware.ts#L27-L39) |
| M20 | **CORS hardcoded to a dev origin.** `origin: "http://localhost:3000"` — safe as written (not a wildcard, no reflection) but will break in production, inviting someone to "fix" it by reflecting `req.headers.origin`. | [`app.ts:25-30`](src/app.ts#L25-L30) |
| M21 | **Live third-party secrets in plaintext on disk, no `.env.example`.** `.env` holds real Resend, Gmail app-password, Cloudinary, Razorpay, JWT, and super-admin values. History is clean, but anything pasted into a chat or screen share should be treated as burned. Rotate before going live. | `.env` |

---

## 4. LOW

- **`OrderItem.productVariantId` has no index** — the FK uses `onDelete: Restrict`, so every variant delete/update sequentially scans `OrderItem`. The one genuinely missing FK index.
- **Order/product listing sorts on unindexed columns** — `@@index([userId])` then sorts the whole matched set per page. Wants `@@index([userId, createdAt])`; `Product.createdAt` has no index at all.
- **`validate` middleware discards coerced params/query** — the `body` branch writes `req.body = result.data`, the `params` and `query` branches throw `result.data` away. Controllers defensively re-parse, so Zod runs twice on those routes. A trap for anyone who trusts the middleware.
- **Retry wrapper doesn't cover its own failure modes** — `RETRYABLE_CODES = ["P2034"]` only; `P2028` (tx timeout) and `P1017` (connection closed) are reachable given H8's round-trip loops.
- **`isIdempotencyConflict` matches any P2002** — an unrelated unique violation inside the transaction is silently swallowed as "already cancelled". `isUniqueConstraintOn(err, "idempotencyKey")` already exists in `transaction-retry.util.ts:51`.
- **Customer cancel transaction is weaker than checkout's** — reads the order outside the transaction then uses that stale array inside it; default Read Committed, no retry wrapper.
- **`idempotencyKey` is globally unique, not per-user** — client-supplied, so adversarial key-squatting can block another user's checkout with an unexplainable 409. Wants `@@unique([userId, idempotencyKey])`.
- **`getAvailableCoupons` unbounded** — no `take`; every customer pulls the entire active coupon catalogue with a nested `claims` relation.
- **Admin params unvalidated on `:id` routes** — `Number(req.params.id)` → `NaN` → Prisma error → 500 with the raw message (M2). `categoryIdSchema` and `colorIdSchema` are defined but never used.
- **ADMIN and SUPER_ADMIN not distinguished** for coupon and customer management. Product decision, not a bug.
- **No shipped state** — the enum is `PENDING, CONFIRMED, CANCELLED, DELIVERED`, so a customer can self-cancel an order already in transit.
- **Coupon expiry is UTC day-granular** — a coupon expiring "today" stays usable until 05:29 IST the next morning.
- **`express.json()` has no explicit limit** — defaults to 100kb, which is fine; set it explicitly.
- **Zero tests, zero CI, no README, no `.env.example`.**
- **`JWT_ACCESS_SECRET =` has a space before the `=`** — dotenv 17.4.2 parses it correctly (verified empirically), so this is cosmetic. But Docker `env_file`, `set -a; source .env`, and some CI secret loaders are *not* as forgiving and would silently produce an undefined secret.

---

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
7. Release coupon claims on cancel/rollback/expiry (H3)

**Then — security hardening:**
8. `app.use(helmet())` and `express-rate-limit` (M1, H1) — an afternoon, very high value
9. OTP attempt cap + resend cooldown (H2)
10. Strip token/OTP logging (M3)
11. Generic production error messages (M2)
12. `npm audit fix` (H7)

**Then — performance:**
13. Paginate the product listings (C5) + add `compression` (M9) — the two cheapest large wins
14. Set the connection pool `max` (M7) and add graceful shutdown (M8)
15. Batch the transaction loops (H8)

**Ongoing:** refund flow (H4), refresh-token rotation + logout (H5), Razorpay webhook (M5), Redis caching (M18).

---

## 7. Confidence notes

- **Executed and verified:** `npx tsc --noEmit`, `npx prisma migrate status`, the `psql` table query, `node -e "require('node:stream/iter')"`, `npm audit`, and the git-history secret sweep. B1, B2, and H7 are reproduced facts.
- **Verified by reading the exact source:** C1, C2, C3, C4, C5, H1, H3, H5, H6, M1, M2, M3. I opened each cited line and confirmed the quoted code.
- **Read from source, not executed:** the remaining MEDIUM/LOW items. The reasoning is traced through real code, but no integration test was run against them.
- **Not assessed:** production deployment config, infrastructure, load behaviour under real traffic, and whether `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` differ in your deployed environment (M12's severity depends on that).
