# Budgie

Android app for tracking household expenses. Users log expenses manually or by photographing a receipt (an LLM suggests a category), set up recurring expenses, ask an LLM questions about their spending in plain English, and generate monthly reports. Expenses belong to a household that several users share.

The data model and API were planned by the developer step by step. Respect the decisions below, and ask before changing them.

## Repo layout

```
Budgie/
  apps/
    api/                TypeScript backend (all backend work happens here)
      prisma/           schema.prisma, migrations/ (one clean init migration), seed.ts
      prisma.config.ts  Prisma 7 config (datasource URL, seed command)
      generated/prisma/ generated client (gitignored, recreate with `npx prisma generate`)
      src/
        config.ts       env loading, fails fast on missing vars
        prisma.ts       shared PrismaClient (driver adapter)
        app.ts          Express app (no listen)
        server.ts       starts the server
        lib/validate.ts input validators (see Validation)
        routes/         households.ts, me.ts (health.ts if present)
        services/       householdsService.ts, ... (the me functions live in their own service)
        middleware/     errorHandler.ts (HttpError), auth.ts (requireAuth), household.ts (requireMember, requireOwner)
```

Always run npm and Prisma commands from `apps/api`.

## Stack

- **Backend:** TypeScript, Express 5 (async errors reach the error handler automatically), ESM (`"type": "module"`, run with `tsx` in dev; use `.js` extensions in relative imports).
- **Database:** PostgreSQL 16. Development uses a local Docker container; **Neon** will host production later. Prisma **7** with the `pg` driver adapter. **Pin Prisma to 7.x** (and `pg@8`). Prisma 8 (rc) has a different CLI and is not used here.
- **Auth:** AWS Cognito, region `eu-central-1`. The app has its **own login/registration screens** (Amplify/Cognito SDK, SRP flow), not the hosted UI. The app sends the **ID token** as `Authorization: Bearer <token>`; the backend verifies it with `aws-jwt-verify`. Email and password changes happen only through Cognito, never through our API.
- **Files:** AWS S3 for receipt images (temporary only).
- **LLM:** the **OpenAI API** for receipt categorization and spending Q&A (not built yet). The key stays on the backend only.
- **Validation:** hand-written validators in `src/lib/validate.ts`. **No zod.**

## Commands (from apps/api)

```bash
npm run dev            # tsx watch src/server.ts
npm run db:migrate     # prisma migrate dev
npm run db:seed        # seeds the built-in categories (including "Other")
npm run db:studio      # Prisma Studio (Ctrl+C to stop)
npx prisma generate    # regenerate the client
```

Dev database: Docker container `expenses-db` (postgres:16, user `postgres`, password `dev`, port 5432). Two databases: `expenses` (dev) and `expenses_test` (tests). Do not run another Postgres on port 5432.

Production database (later): **Neon**, SSL required (`sslmode=require`). Use the direct (non-pooled) string for migrations, apply with `prisma migrate deploy`, never `migrate dev`. Never commit connection strings.

Environment variables (`apps/api/.env`): `DATABASE_URL`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `OPENAI_API_KEY`, optional `PORT`.

Schema changes always go through a new `prisma migrate dev --name <change>`. Never edit an existing migration. The history is currently one clean `init` migration with a hand-written index appended (see Categories). Prisma cannot model that expression index, so a later `migrate dev` may try to drop it: delete that DROP line from the generated SQL.

## Data model decisions

**Users and households**
- `User`: `id`, `cognitoId` (Cognito `sub`, unique), `name` (required), `email` (unique), `createdAt`. No passwords or tokens in our DB. The row is created by an upsert on the first authenticated request, with `name` taken from the token's `name` claim. The upsert must not overwrite `name` on later requests (the user can rename themselves through `PATCH /me`).
- `Household`: `name`, `defaultCurrency` (`Currency`, default `USD`), `timeZone` (IANA string such as `Asia/Jerusalem`, default `UTC`). On create, all three are **required** and the app sends the device's time zone. Time zones are validated with `Intl.DateTimeFormat`, not an enum.
- Users and households are many-to-many through `HouseholdMember`: composite primary key `(userId, householdId)` (Prisma name `userId_householdId`), `role` (`OWNER` / `MEMBER`), `joinedAt`, `leftAt`, index on `householdId`. Leaving sets `leftAt` (soft leave); rejoining clears it. "Active member" means `leftAt IS NULL`.

**Money**
- Amounts are a single `Int` in minor units, never floats. Field is `amount`.
- `currency` is a `Currency` enum on every expense and recurring rule. The enum only has 2-decimal currencies. Symbols and names live in code, not in the database.

**Categories**
- One `Category` table. Built-ins have `householdId = null` and are seeded by `prisma/seed.ts` (including "Other"). Custom categories have a `householdId` and cascade-delete with the household.
- Built-ins cannot be renamed or deleted. Custom categories can be edited and archived (`isArchived`).
- Case-insensitive uniqueness, including built-ins, comes from the hand-written index `Category_household_lower_name_key` on `(COALESCE("householdId", 0), lower("name"))`. `@@unique([householdId, name])` alone does not protect built-ins because nulls are distinct in Postgres.
- Category picker query: `OR: [{ householdId: null }, { householdId }]`, excluding archived.

**Expenses**
- Fields: amount, currency, `date` (`@db.Date`), category, `paidBy` and `createdBy` (both `User`, relations `PaidExpenses` / `CreatedExpenses`), household, optional description, optional `recurringRuleId`.
- `@@unique([recurringRuleId, date])`. Indexes: `(householdId, date)`, `(householdId, categoryId)`, `(householdId, paidById)`.

**Recurring rules** (not implemented yet, being rewritten by the developer)
- `Frequency`: `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `YEARLY`. A rule is a template (name, amount, currency, category, payer, `createdBy`) plus a schedule (`startDate`, optional `endDate`, nullable `nextOccurrence`, `dayOfMonth` for monthly only).
- There is no skip table (`RecurringRuleSkip` was removed). Deleting a rule keeps its past expenses (link set to null).

**Receipts**
- No Receipt table. The flow is synchronous: upload to S3, backend calls the LLM and returns suggestions, the user confirms in the app, the app creates a normal expense, the backend deletes the image. An S3 lifecycle rule expires abandoned images.

**Invites** (not rewritten yet)
- Shareable links sent manually by the owner. `Invite`: `householdId`, `tokenHash` (unique, SHA-256 of a random token; the raw token is returned once at creation and never stored), `status` (`PENDING`, `ACCEPTED`, `EXPIRED`), `expiresAt` (7 days), `createdAt`, `acceptedAt`. Single-use. Accept in one transaction with a conditional `updateMany` and a count check.

## Implemented endpoints

All routes require `requireAuth` (mounted in `app.ts`). Protected household routes use `requireMember`, then `requireOwner` where noted.

**Households** (`/households`)
| Method and path | Who | Behavior |
|---|---|---|
| `POST /` | any user | Body `{ name, defaultCurrency, timeZone }`, all required. Creates the household and an OWNER membership. `201` `{ id, name, defaultCurrency, timeZone, role: "OWNER" }`. |
| `GET /:id` | member | `200` `{ id, name, defaultCurrency, timeZone, role }` (role is the caller's). |
| `PATCH /:id` | owner | Any of `name`, `defaultCurrency`, `timeZone`. `400 "Nothing to update"` if none are given. `200` with the same shape as above. |
| `GET /:id/members` | member | Active members only, ordered by `joinedAt`: `[{ userId, name, role }]`. Never includes emails. |
| `DELETE /:id/members/me` | member | Leave. `204`, empty body. See leave rules. |
| `DELETE /:id/members/:userId` | owner | Remove a member (soft, sets `leftAt`). `204`. `400` if `:userId` is the caller (use leave). `404` if that user is not an active member. |
| `DELETE /:id` | owner | Deletes the household and all its data. `204`. |

`/:id/members/me` is registered **before** `/:id/members/:userId`, otherwise `me` would be parsed as a user id.

**Leave rules**
- A MEMBER just leaves. An OWNER leaving while another active owner exists just leaves. If no active owner remains, a random active member is promoted to OWNER. If nobody is left, the household and all its data are deleted. All in one transaction.
- Deleting a household deletes, in this order and in one transaction: expenses, recurring rules, member rows, the household. Categories and invites cascade.

**Me** (`/me`)
| Method and path | Behavior |
|---|---|
| `GET /` | `200` `{ id, name, email }`. |
| `GET /households` | Active households of the caller: `[{ householdId, name, role }]`, ordered by `joinedAt`. |
| `PATCH /` | Body `{ name }`. `200` `{ id, name, email }`. Email and password are Cognito only. |

## API conventions

- Status codes: `400` validation errors, `400 "invalid id"` for a malformed household id (not a positive integer up to 2147483647), checked before any membership lookup, `400` / `413` / `415` for a malformed, oversized or unsupported request body, `401` missing or invalid token, `403` a member calling an owner-only route, `404` for a non-member of an existing household or someone who left (existence is not revealed), `404` for a member who is not found on leave or remove.
- Deletes return `204` with no body (`res.status(204).end()`). Updates return `200`. Creates return `201`.
- Routers validate input and pass clean values to services. Services do not re-validate.
- Throw `HttpError(status, message)` from `middleware/errorHandler.ts` for expected errors; Express 5 forwards async errors, so no try/catch wrappers.
- `requireMember` reads `req.params.id`, loads the membership (404 if missing or `leftAt` is set) and sets `req.membership`. `requireOwner` needs `requireMember` first and returns `403` unless the role is OWNER. Handlers use `req.membership` for the household id and role instead of re-parsing.
- Keep `app.ts` (builds the app) separate from `server.ts` (listens), so tests import the app.
- Use the single shared Prisma client from `src/prisma.ts`. Prisma does not index foreign keys automatically; add indexes deliberately.

## Validation (`src/lib/validate.ts`)

- `validName`: string, trimmed, 1 to 100 characters.
- `validCurrency`: must be a value of the `Currency` enum.
- `validTimeZone`: valid IANA zone via `Intl.DateTimeFormat`; returns the normalized name.
- `validId`: positive integer, otherwise `HttpError(400, "invalid id")`.
- `optional(value, validator)`: returns `undefined` when the value is `undefined`, otherwise runs the validator.

## Testing

Use Vitest with Supertest against the real Express app (`import { app } from "../src/app.js"`) and a real Postgres database. Put all files in `apps/api/tests/`. Run with `npx vitest run` (do not edit `package.json` to add scripts).

**Database safety**
- Tests read `process.env.DATABASE_URL`. Never read `.env`. Ask the developer to export `DATABASE_URL` in the shell, pointing at the **`expenses_test`** database. An already exported variable wins over `.env` because dotenv does not override it.
- Before doing anything, check that the database name in `DATABASE_URL` ends with `_test`. If it does not, stop and tell the developer. Never run tests, `deleteMany` or migrations against the dev database.
- The test database needs the migration applied: `npx prisma migrate deploy` (only against a `_test` database).
- Between tests, clean tables in a foreign-key-safe order (expenses, recurring rules, invites, household members, categories created by tests, households, users). Do not delete the seeded built-in categories.

**Authentication in tests**
- Real Cognito is not available in tests (password auth is turned off on the app client). Mock the auth middleware with `vi.mock` of `../src/middleware/auth.js` so that `requireAuth` reads a test header such as `x-test-user-id`, loads that `User` from the database, sets `req.user`, and returns `401` when the header is missing. Do not edit the real file. Create test users directly with Prisma.
- Add one test confirming that routes return `401` without credentials.

**What to cover**
- For every endpoint in the table: the happy path and the exact response shape (assert there are no extra fields, in particular no emails in the members list and no `cognitoId` anywhere).
- Validation: missing or wrong-typed fields, empty or over-long name, unknown currency, invalid time zone, `PATCH` with an empty body, invalid ids (`abc`, `0`, `-1`, `1.5`, a huge number).
- Authorization: non-member gets `404` on every `/:id` route; MEMBER gets `403` on `PATCH /:id`, `DELETE /:id` and `DELETE /:id/members/:userId`; a user who has left gets `404` afterwards.
- Leave and remove: member leaves; sole owner leaves with members left (someone is promoted to OWNER and still active); one of two owners leaves (nobody is promoted); last person leaves (household and its expenses, rules and members are gone); owner removes a member; owner tries to remove themselves (`400`); removing a non-member or someone who already left (`404`); leaving twice (`404`); the route order (`DELETE /:id/members/me` must not be treated as a user id).
- `DELETE /:id` removes the household together with its expenses, recurring rules and members, created directly with Prisma for the test.
- `/me`: profile, households list (only active households, correct roles), rename, rename with invalid input, and that renaming does not change the email.

When finished, give a short report: tests written, tests passing, and a list of every failure or suspicious behavior with the details described above.

## Secrets

Never read, open, print or commit `.env` files or any API keys, tokens or connection strings. If a value is needed, ask the developer. Variable names are documented in `apps/api/.env.example` (names only). `.env` stays in `.gitignore`.

## Status

Done: schema and a single clean migration, seeded categories, Cognito user pool, `requireAuth`, `requireMember` / `requireOwner`, validators, the household routes and services, the `/me` routes.

## Not decided yet

- Android framework (native Kotlin with Amplify vs. cross-platform).
- How the LLM Q&A queries data (generated SQL vs. predefined query functions).
- Whether to split expenses between several payers (not in v1).
- Which OpenAI models to use for receipt images and for Q&A.
- For production on Neon: pooled or direct connection at runtime.
