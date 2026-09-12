# e-comerce-backend

REST API for the Raviscort storefront and admin panel.

Express 5 · TypeScript (strict) · Prisma 7 · PostgreSQL 17 · Redis · Razorpay · Cloudinary · argon2 · zod 4

---

## Requirements

| Tool       | Version                                        |
| ---------- | ---------------------------------------------- |
| Node.js    | 22 or newer                                    |
| PostgreSQL | 17 (with the `pg_trgm` extension available)    |
| Redis      | 6 or newer                                     |

A Razorpay account and a Cloudinary account are needed for checkout and for
product images. Everything else runs locally.

---

## Getting started

```bash
npm install
cp .env.example .env          # then fill in real values
npx prisma migrate deploy
npx prisma generate           # the client is gitignored — this is not optional
npm run seed                  # creates the SUPER_ADMIN from the .env values
npm run dev
```

The API listens on `http://localhost:5000` and every route is mounted under
`/api/v1`. `GET /api/v1/health` answers without auth and without touching the
database.

Two things bite people on a fresh clone:

- **`npx prisma generate` must run before anything else.** `generated/prisma`
  is gitignored, so a fresh clone has no client and both the app and the seed
  fail on import.
- **A second `.env` value shadows nothing.** `dotenv` does not override
  variables that are already exported in the shell.

---

## Scripts

| Script              | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | `tsx watch` against `src/server.ts`                 |
| `npm run build`     | Type-checks and emits to `dist/`                    |
| `npm start`         | Runs the build output (`dist/src/server.js`)        |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `prisma/`            |
| `npm run seed`      | Seeds the super admin and the base catalogue        |

CI (`.github/workflows/ci.yml`) runs migrations against a throwaway Postgres,
then typecheck, build, and a schema-drift check on every push and pull
request.

---

## Configuration

Every variable is documented inline in [`.env.example`](.env.example). The ones
that change behaviour rather than just credentials:

| Variable                  | Effect                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `CORS_ORIGINS`            | Comma-separated exact origins. No wildcards, no reflection.                            |
| `TRUST_PROXY`             | `false`, `true`, a hop count, or a subnet. Wrong here means rate limiting sees the proxy. |
| `COOKIE_DOMAIN`           | Leave unset locally. In production it scopes the auth cookies across `raviscort.com` and `api.raviscort.com`. |
| `APP_UTC_OFFSET_MINUTES`  | Minutes east of UTC (330 = IST). Decides what "today" means for date filters and coupon validity. |
| `DATABASE_POOL_MAX`       | Each checkout holds a connection for a whole Serializable transaction.                 |
| `RAZORPAY_WEBHOOK_SECRET` | Without it the webhook rejects everything and payment state depends on the browser calling back. |

Write `KEY=value` with no space before the `=`. `dotenv` tolerates a stray
space; Docker `env_file` and `set -a; source .env` do not, and they fail by
silently producing an undefined value.

---

## Layout

```
src/
  app.ts            Express app: helmet, compression, CORS, routers, error handler
  server.ts         Startup, the expired-checkout sweeper, graceful shutdown
  config/           Prisma (pg driver adapter), Redis, Razorpay, Cloudinary
  routes/           Route tables — every route declares its zod schemas here
  middlewares/      authenticate, authorize, validate, rate limits, uploads
  controllers/      Request/response only; they read validated input, never re-parse
  services/         Business logic and every database call
  utils/            Stock, coupon redemption, order amounts, transaction retry
  validations/      zod schemas, one module per resource
prisma/             Schema, migrations, seed
```

### Request validation

`validate({ body, params, query })` in the route table is the only place input
is parsed. It writes the coerced result back onto the request and stores it on
`req.validated`, so a controller reads it with the typed accessor:

```ts
const { id } = validated<CouponIdParam>(req, "params");
```

`validated()` throws a 500 if the route forgot to declare that source, which
makes a missing schema loud instead of handing the controller a raw string.
Controllers must not call `schema.parse()` themselves: schemas with transforms
(`"true"` → `true`, `"2026-09-12"` → `Date`) are not idempotent, so parsing
twice fails.

### Money, stock and idempotency

- Order totals are recomputed server-side inside the transaction from database
  prices. The client never sends an amount.
- Stock is reserved with a conditional `UPDATE ... WHERE stock >= quantity` and
  a row-count assertion, so two concurrent checkouts cannot oversell.
- Checkout, cancellation and payment confirmation run at `Serializable`
  isolation behind `withTransactionRetry`, which retries `P2034` write
  conflicts, `P2028` transaction timeouts and `P1017` dropped connections.
- Every mutating money path takes a client-supplied `idempotencyKey`. Orders
  are unique on `(userId, idempotencyKey)`, refunds on `(orderId,
  idempotencyKey)`, and item actions on `(orderItemId, idempotencyKey)`.
  Replays re-read and return the existing row instead of acting twice.

`isUniqueConstraintOn(error, column)` is how a `P2002` is attributed to a
column. Do not compare `error.code === "P2002"` directly — an unrelated unique
violation inside the same transaction would then be swallowed as a replay.

### Order lifecycle

```
PENDING ──→ CONFIRMED ──→ SHIPPED ──→ DELIVERED
   │            │            │
   └────────────┴────────────┴──→ CANCELLED
```

Customers may cancel while an order is `PENDING` or `CONFIRMED`, and may return
items from a `DELIVERED` order. `SHIPPED` is deliberately outside the customer
cancel window; only an admin can cancel an order in transit. Cancelling an
online-paid order issues a Razorpay refund for the outstanding amount.

---

## Webhooks

`POST /api/v1/webhooks/razorpay` is mounted **before** `express.json()` so the
handler can verify the HMAC over the raw body. Point the Razorpay dashboard at
it and set `RAZORPAY_WEBHOOK_SECRET`.

---

## Migrations

```bash
npx prisma migrate dev --create-only --name <change>   # write the SQL
npx prisma migrate deploy                              # apply it
npx prisma generate                                    # refresh the client
```

Never edit a migration that has already been applied — the checksum recorded in
`_prisma_migrations` will no longer match and `prisma migrate dev` will ask to
reset the database.
