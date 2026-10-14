# Budgie

Android app for tracking household expenses. Users log expenses manually or by photographing a receipt (an LLM suggests a category), set up recurring expenses, ask an LLM questions about their spending in plain English, and generate monthly reports. Expenses belong to a household that several users share.

The data model and API were planned by the developer step by step. Respect the decisions below, and ask before changing them.

## Repo layout

```
Budgie/
  apps/
    api/                TypeScript backend (all backend work happens here)
      prisma/           schema.prisma, migrations/ (init, then add_expense_name), seed.ts
      prisma.config.ts  Prisma 7 config (datasource URL, seed command)
      generated/prisma/ generated client (gitignored, recreate with `npx prisma generate`)
      src/
        config.ts       env loading, fails fast on missing vars
        prisma.ts       shared PrismaClient (driver adapter)
        app.ts          Express app (no listen)
        server.ts       starts the server
        lib/validate.ts input validators (see Validation)
        lib/cursor.ts   expense list cursor: encode and decode side by side (see Expenses)
        routes/         householdsRouter.ts (households and invites), meRouter.ts
        services/       householdsService.ts, invitesService.ts, meService.ts, categoriesService.ts, expensesService.ts
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

Schema changes always go through a new `prisma migrate dev --name <change>`. Never edit an existing migration. The history is currently the `init` migration (with a hand-written index appended, see Categories) followed by `add_expense_name`. Prisma cannot model that expression index, so a later `migrate dev` may try to drop it: delete that DROP line from the generated SQL.

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
- The hand-written index `Category_household_lower_name_key` on `(COALESCE("householdId", 0), lower("name"))` guarantees case-insensitive uniqueness only inside one bucket: the built-ins are one bucket (keyed `0`), each household is its own. (`@@unique([householdId, name])` alone would not even keep built-ins unique among themselves, because nulls are distinct in Postgres.) A household name clashing with a built-in is checked in the service, not by the index: a raw tagged-template `$queryRaw` with `"householdId" IS NULL AND lower("name") = lower(${name}) LIMIT 1`, the same folding as the index. Not Prisma's `mode: "insensitive"`, which compiles to `ILIKE` and treats `%` and `_` as wildcards.
- Category picker query: `OR: [{ householdId: null }, { householdId }]`, excluding archived.
- A category is built-in when `householdId` is null. Every category response has the shape `{ id, name, isArchived, isBuiltIn }`, never the household id.
- Names are unique case-insensitively across the built-ins and the household's categories, archived ones included (an archived name stays reserved). Within a household the unique index enforces it. The index keys built-ins as household `0`, so it does not catch a clash with a built-in: create and rename check the built-ins first (built-ins only change through the seed, so that check has no race).
- At most 100 custom categories per household, archived ones included (`MAX_CATEGORIES_PER_HOUSEHOLD` in `categoriesService.ts`). Built-ins don't count.
- Archiving is the way to retire a category that is in use (expenses keep it). An archived name stays reserved: to use that name again, unarchive the archived category (or rename it).

**Expenses**
- Fields: `name` (required), amount, currency, `date` (`@db.Date`), category, `paidBy` and `createdBy` (both `User`, relations `PaidExpenses` / `CreatedExpenses`), household, optional `description`, optional `recurringRuleId`.
- `name`: required, trimmed, 1 to 100 characters (same rule as `validName`). Expenses generated by a recurring rule copy the rule's name.
- `description`: optional, trimmed, up to 500 characters; an empty string means none (stored as null).
- No future dates: an expense can only be created or moved to today or a past date (`400 "Date can't be in the future"`). "Today" is the current date in the household's `timeZone`, not the server's UTC date (`todayInTimeZone` / `assertNotFutureDate` in `expensesService.ts`; enforced on create and on `PATCH` when `date` is given). Not applied to list filters (`from`, `to`). Recurring occurrences appear in the future only on the calendar, never as expense rows.
- Response shape, shared by every expense route (defined once in `services/expensesService.ts` as `expenseSelect` plus `toExpenseResponse`): `{ id, name, amount, currency, date, categoryId, paidById, createdById, description, isRecurring }`. `date` is `YYYY-MM-DD`. `isRecurring` is true when the expense has a recurring rule. The rule id and `householdId` are never returned.
- `@@unique([recurringRuleId, date])`. Indexes: `(householdId, date)`, `(householdId, categoryId)`, `(householdId, paidById)`, `(categoryId)`.

**Recurring rules** (not implemented yet, being rewritten by the developer)
- `Frequency`: `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `YEARLY`. A rule is a template (name, amount, currency, category, payer, `createdBy`) plus a schedule (`startDate`, optional `endDate`, nullable `nextOccurrence`, `dayOfMonth` for monthly only).
- There is no skip table (`RecurringRuleSkip` was removed).
- Deleting a rule keeps its past expenses by default (link set to null). `DELETE` will accept `?deleteExpenses=true` (`true`, `false` or missing; anything else is `400`), which deletes the household's expenses for that rule and the rule in one transaction, scoped by household.
- The delete locks the rule row (`SELECT … FOR UPDATE`); the expense generator must take the same lock.
- Rule responses will include the count of generated expenses, so the app can show it before deleting.
- If a rule's payer leaves the household, the rule keeps naming them. The generator inserts expenses directly, without an active-payer check. The rule's creator or an owner can change the payer.
- Indexes: `(categoryId)`, `(householdId)`, `(nextOccurrence)`.

**Receipts**
- No Receipt table. The flow is synchronous: upload to S3, backend calls the LLM and returns suggestions, the user confirms in the app, the app creates a normal expense, the backend deletes the image. An S3 lifecycle rule expires abandoned images.

**Invites** (implemented in `services/invitesService.ts`)
- Shareable links sent manually by the owner. `Invite`: `householdId`, `tokenHash` (unique, SHA-256 hex of a random token; the raw token is returned once at creation and never stored or logged), `status` (`PENDING`, `ACCEPTED`, `EXPIRED`), `expiresAt` (7 days), `createdAt`, `acceptedAt`. Single-use.
- Token: `crypto.randomBytes(32)` as base64url (43 characters). Incoming tokens are hashed before the lookup. Tokens travel only in the JSON body, never in the URL. The backend returns the token, the app builds the link.
- At most 25 active invites per household (active = `PENDING` and `expiresAt` in the future). Owners can list active invites and cancel one (the row is deleted).
- Creating an invite and accepting one lock the household row first (`lockHousehold` in `householdsService.ts`, `SELECT … FOR UPDATE`), so the cap can't be exceeded and a join can't race with leave, remove or delete.
- Expiry is computed on the fly from `expiresAt`; request handlers never write `EXPIRED`. Later: a cleanup job that sets `EXPIRED` on old pending invites (and maybe deletes old invites). Not built yet.
- Accept runs in one transaction: look up by hash and check (404 unknown, 410 expired, 410 used), then 409 if the caller is already an active member (the invite is not consumed), then claim with a conditional `updateMany` (`id`, `PENDING`, `expiresAt > now`) and a count check (410 if not exactly 1), then add the member. A former member's row is reactivated (`leftAt` null, role `MEMBER`, never `OWNER`, `joinedAt` reset to now); otherwise a `MEMBER` row is created.

## Implemented endpoints

All routes require `requireAuth` (mounted in `app.ts`). Protected household routes use `requireMember`, then `requireOwner` where noted.

**Households** (`/households`)
| Method and path | Who | Behavior |
|---|---|---|
| `POST /` | any user | Body `{ name, defaultCurrency, timeZone }`, all required. Creates the household and an OWNER membership. `201` `{ id, name, defaultCurrency, timeZone, role: "OWNER" }`. |
| `GET /:id` | member | `200` `{ id, name, defaultCurrency, timeZone, role }` (role is the caller's). |
| `PATCH /:id` | owner | Any of `name`, `defaultCurrency`, `timeZone`. `400 "Nothing to update"` if none are given. `200` with the same shape as above. |
| `GET /:id/members` | member | Ordered by `joinedAt`: `[{ userId, name, role, isActive }]` (`isActive` is true when `leftAt` is null). Active members only by default; `?includeFormer=true` also returns members who left or were removed (`false` is also accepted; any other value or a repeated parameter returns `400 "includeFormer must be true or false"`). The caller must be an active member. Never includes emails. The app uses `includeFormer=true` as a name lookup, to gray out departed users and filter expenses by them. |
| `DELETE /:id/members/me` | member | Leave. `204`, empty body. See leave rules. |
| `DELETE /:id/members/:userId` | owner | Remove a member (soft, sets `leftAt`). `204`. `400` if `:userId` is the caller (use leave). `404` if that user is not an active member. |
| `DELETE /:id` | owner | Deletes the household and all its data. `204`. |

`/:id/members/me` is registered **before** `/:id/members/:userId`, otherwise `me` would be parsed as a user id.

**Invites** (on the households router)
| Method and path | Who | Behavior |
|---|---|---|
| `POST /:id/invites` | owner | Creates a single-use link valid for 7 days. `201` `{ token, expiresAt }`; the raw token is returned only here. `409` if the household already has 25 active invites. |
| `GET /:id/invites` | owner | Active invites, newest first: `[{ id, createdAt, expiresAt }]`. Never anything token-related. |
| `DELETE /:id/invites/:inviteId` | owner | Cancels an invite (deletes the row, filtered by invite id and the caller's household). `:inviteId` checked with `validId`. `204`. `404 "Invite not found"` if no such invite in this household. |
| `POST /join/preview` | any user | Body `{ token }`. `200` `{ householdName, members: [{ name, role }] }`, active members ordered by `joinedAt`. No emails or ids. Changes nothing. |
| `POST /join` | any user | Body `{ token }`. Joins as `MEMBER`. `200` `{ id, name, defaultCurrency, timeZone, role: "MEMBER" }`. |

Errors for both join routes: `400 "Invalid token"` (not a string of 1 to 128 characters), `404 "Invite not found"`, `410 "Invite has expired"`, `410 "Invite was already used"`, and on `/join` only `409 "Already a member of this household"`. `/join/preview` and `/join` are registered **before** the `/:id` routes.

**Categories** (`/households/:id/categories`, in `services/categoriesService.ts`)
| Method and path | Who | Behavior |
|---|---|---|
| `POST /` | member | Body `{ name }` (trimmed, 1 to 100 characters). `201` `{ id, name, isArchived, isBuiltIn }`. `409 "A category with this name already exists"` for a case-insensitive duplicate of a built-in or of a household category, archived ones included. `409 "Category limit reached"` when the household already has 100 categories (archived included). Runs in a transaction that locks the household row first (`404 "Household not found"` if it is gone), then checks the built-ins, counts and creates. |
| `GET /` | member | Picker list: built-ins plus the household's categories, ordered by name case-insensitively (sorted in the service with `localeCompare`, sensitivity `base`, ties by id; not by the database collation): `[{ id, name, isArchived, isBuiltIn }]`. Archived excluded unless `?includeArchived=true`; `false` is also accepted; any other value or a repeated parameter returns `400`. |
| `PATCH /:categoryId` | member | Body `{ name?, isArchived? }` (`isArchived` must be a JSON boolean, otherwise `400 "isArchived must be true or false"`). `200` `{ id, name, isArchived, isBuiltIn }`. `400 "Nothing to update"` if neither is given. `403 "Built-in categories can't be changed"`. `404 "Category not found"` for another household's category or a missing id (the final update filters by id and household id). `409` for a duplicate name. |
| `DELETE /:categoryId` | owner | Deletes an unused custom category. `204`. `403 "Built-in categories can't be deleted"`. `404 "Category not found"` for another household's category or a missing id. `409` if an expense or a recurring rule uses it (archive it instead). |

`:categoryId` is checked with `validId` (`400 "Invalid id"`). There is no route to get a single category; the app uses the list.

**Expenses** (`/households/:id/expenses`, in `services/expensesService.ts`)
| Method and path | Who | Behavior |
|---|---|---|
| `POST /` | member | Body `{ name, amount, date, categoryId, paidById, currency?, description? }`. `currency` defaults to the household's `defaultCurrency`. `createdById` is the caller. `201` with the expense shape. `400 "Invalid category"` (archived, another household's or missing), `400 "Invalid payer id"` (not an active member), `400 "Date can't be in the future"`. |
| `GET /` | member | Newest first (`date` desc, then `id` desc). Optional query: `from`, `to` (`YYYY-MM-DD`, inclusive; `from` must not be after `to`), `categoryId`, `paidById` (any user id, so filtering by someone who left works), `limit` (1 to 100, default 50), `cursor`. A repeated or invalid parameter is `400`. `200` `{ items: [expense shape], nextCursor, totalCount }`. `totalCount` is the number of expenses matching the filters, ignoring the cursor, so it is the same on every page (it can change between requests if expenses are added or deleted). |
| `GET /:expenseId` | member | `200` with the expense shape. `404 "Expense not found"` for another household's expense or a missing id. |
| `PATCH /:expenseId` | payer, creator or owner | Any subset of `{ name, amount, currency, date, categoryId, paidById, description }` (`ExpenseUpdate`). `400 "Nothing to update"` if none are given. `description`: a string sets it, `null` or an empty string clears it. A changed `paidById` must be an active member (`400 "Invalid payer id"`); a changed `categoryId` must be built-in or the household's and not archived (`400 "Invalid category"`). An unchanged payer or category is never rechecked, so an expense can keep a payer who left or a category archived since. A given `date` must not be in the future. `200` with the expense shape. |
| `DELETE /:expenseId` | payer, creator or owner | `204`, empty body. |

- `:expenseId` is checked with `validId` (`400 "Invalid id"`). Every query is scoped by the household id from `req.membership`.
- **Permission:** only the expense's current payer, its creator or an owner may update or delete it. Anyone else gets `403 "Only the payer, the creator or an owner can change this expense"`. This is intended: any member can enter an expense on someone else's behalf (`paidById` is another member), and the creator keeps edit and delete rights, even after the payer changes. Changing the payer gives the new payer the payer's right and takes it from the old one.
- **Recurring expenses** (`recurringRuleId` not null): `DELETE` returns `409 "Recurring expenses can't be deleted; end the rule instead"`. `PATCH` may change only `amount`, `paidById` and `description`; a body with `name`, `currency`, `date` or `categoryId` returns `409 "Only amount, payer and description can be changed on a recurring expense"`.
- Order of checks on `PATCH` and `DELETE`: the router's validation (`400`), then `404` (not in this household), `403` (permission), `409` (recurring), then the category, payer and date checks (`400`).
- **Pagination:** keyset on `(date, id)`, never offset. The service fetches `limit + 1` rows to know whether there is a next page, and runs the count alongside the page query (`Promise.all`). The cursor is opaque to the app and lives in `lib/cursor.ts` (`encodeExpenseCursor` / `decodeExpenseCursor`): base64url of `YYYY-MM-DD:id:fingerprint`, the last row's date and id plus a short SHA-256 fingerprint of the household id and the active filters (`householdId`, `from`, `to`, `categoryId`, `paidById`; not `limit`, which may change between pages). A cursor is tied to its household and its filters: one from another household's list, or reused with other filters, is rejected. Cursors are opaque but not signed: the app could build one, which is harmless because a cursor only sets a starting `(date, id)` and every query stays scoped to the caller's household. `nextCursor` is `null` on the last page. Pass it back as `?cursor=` with the same filters (in any order). The router decodes and validates it and passes `{ date, id }` to the service. A malformed cursor is `400 "Invalid cursor"` (checked first); a cursor issued for different filters is `400 "Cursor doesn't match the filters"`.
- Shared checks: `assertActivePayer` (single-row membership lookup with `leftAt` null, `400 "Invalid payer id"`) and `assertUsableCategory` (built-in or the household's, not archived, `400 "Invalid category"`) in `expensesService.ts`, used by both `POST` and `PATCH`, in the same order: category first, then payer (so a request with both wrong reports `"Invalid category"` on both routes).
- Accepted races (no transaction or lock around the checks): a payer leaving, or a role change, between the checks and the write is allowed, because an expense paid by someone who left is a valid state. The category case is enforced by the foreign key: a category deleted during an update gives `400 "Invalid category"` (P2003), or the category delete returns `409`. A concurrent delete of the expense during an update gives `404` (P2025).

**Leave rules**
- A MEMBER just leaves. An OWNER leaving while another active owner exists just leaves. If no active owner remains, a random active member is promoted to OWNER. If nobody is left, the household and all its data are deleted. All in one transaction.
- Leave, remove, delete, invite creation and invite accept all lock the household row first (`lockHousehold`, `SELECT … FOR UPDATE`), so concurrent membership changes on one household run one at a time. `DELETE /:id` returns `404` if the household is already gone.
- Deleting a household deletes, in this order and in one transaction: expenses, recurring rules, member rows, the household. Categories and invites cascade.

**Me** (`/me`)
| Method and path | Behavior |
|---|---|
| `GET /` | `200` `{ id, name, email }`. |
| `GET /households` | Active households of the caller: `[{ householdId, name, role }]`, ordered by `joinedAt`. |
| `PATCH /` | Body `{ name }`. `200` `{ id, name, email }`. Email and password are Cognito only. |

## API conventions

- Status codes: `400` validation errors, `400 "Invalid id"` for a malformed household id (not a positive integer up to 2147483647), checked before any membership lookup, `400` / `413` / `415` for a malformed, oversized or unsupported request body, `401` missing or invalid token, `403` a member calling an owner-only route, `404` for a non-member of an existing household or someone who left (existence is not revealed), `404` for a member who is not found on leave or remove.
- Categories: `403` for changing or deleting a built-in, `404` for a category of another household or a missing one (same response for both), `409` for a duplicate name or for deleting a category that is in use. The picker excludes archived categories unless `?includeArchived=true`.
- Expenses: `400` for invalid input, a future date, an invalid category or payer, or a bad list parameter or cursor; `403` when the caller isn't the payer, the creator or an owner; `400 "Cursor doesn't match the filters"` for a cursor reused with other filters; `404 "Expense not found"` for another household's expense or a missing one (same response for both); `409` for deleting a recurring expense or changing a field that is fixed on it.
- Deleting a category runs in a transaction: it first checks that the category belongs to the caller's household (so nobody can lock a built-in or another household's category), then locks the category row (`lockCategory`, `SELECT … FOR UPDATE`), then checks for expenses and recurring rules that use it; the foreign key is the final guard. A concurrent expense insert either completes first (the delete returns `409`) or fails on the foreign key after the delete.
- Lock order: the household row first, then the category row. `createCategory` locks the household row (`lockHousehold`); `deleteCategory` locks only the category row (`lockCategory`). No transaction takes both today; one that does must follow this order.
- Deletes return `204` with no body (`res.status(204).end()`). Updates return `200`. Creates return `201`.
- Routers validate input and pass clean values to services. Services do not re-validate.
- Throw `HttpError(status, message)` from `middleware/errorHandler.ts` for expected errors; Express 5 forwards async errors, so no try/catch wrappers.
- Error messages start with a capital letter (`"Invalid id"`, `"Category not found"`), except when they start with a field name, which keeps its own spelling (`"isArchived must be true or false"`). Say "built-in", never "default", for seeded categories.
- `requireMember` reads `req.params.id`, loads the membership (404 if missing or `leftAt` is set) and sets `req.membership`. `requireOwner` needs `requireMember` first and returns `403` unless the role is OWNER. Handlers use `req.membership` for the household id and role instead of re-parsing.
- Keep `app.ts` (builds the app) separate from `server.ts` (listens), so tests import the app.
- Use the single shared Prisma client from `src/prisma.ts`. Prisma does not index foreign keys automatically; add indexes deliberately.

## Validation (`src/lib/validate.ts`)

- `validName`: string, trimmed, 1 to 100 characters.
- `validCurrency`: must be a value of the `Currency` enum.
- `validTimeZone`: valid IANA zone via `Intl.DateTimeFormat`; returns the normalized name.
- `validId`: positive integer with no leading zeros, at most 2147483647, otherwise `HttpError(400, "Invalid id")`.
- `validBoolean`: strict `typeof value === "boolean"` (no `"true"`, `0`, `null`), otherwise `HttpError(400, "<field> must be true or false")` when called as `validBoolean(value, field)`, or `"Invalid boolean value"` without a field name.
- `validAmount`: a JSON number, integer, 1 to 2147483647 (minor units).
- `validDate`: strict `YYYY-MM-DD`, a real calendar day (no rollover such as `2026-02-30`), years 2000 to 2100. Returns a `Date` at UTC midnight, never converted through a local time zone.
- `validDescription`: string, trimmed, at most 500 characters; an empty result becomes `undefined`.
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
- Invites: create, list and cancel (owner only, 25-invite cap); preview and join (invalid, unknown, expired and used tokens, already a member, a former member rejoining as `MEMBER`); the raw token never appears outside the create response; concurrent accepts, the cap under concurrent creates, and a join racing leave or delete (never `500`).
- Categories: create, list, rename, archive and delete; case-insensitive duplicates against the household, its archived categories and the built-ins; `includeArchived` parsing; `403` for built-ins, `404` for another household's or a missing category; `409` for deleting a used category (expenses or rules, archived or not); concurrent creates and renames (never `500`); a delete racing an expense insert (never an orphan); no `householdId` or other household's data in any response.

When finished, give a short report: tests written, tests passing, and a list of every failure or suspicious behavior with the details described above.

## Secrets

Never read, open, print or commit `.env` files or any API keys, tokens or connection strings. If a value is needed, ask the developer. Variable names are documented in `apps/api/.env.example` (names only). `.env` stays in `.gitignore`.

## Status

Done: schema and migrations (`init`, `add_expense_name`), seeded categories, Cognito user pool, `requireAuth`, `requireMember` / `requireOwner`, validators, the household routes and services, the `/me` routes, invites (create, list, cancel, preview, join), categories (create, list, update, delete; done and tested), members list with `?includeFormer`, expenses (create, list with filters, keyset pagination and `totalCount`, get, update, delete; no future dates; done and tested).

Next: recurring rules (being rewritten by the developer: CRUD, the expense generator, `?deleteExpenses=true`), receipts (S3 upload and LLM categorization), spending Q&A, monthly reports, the invite cleanup job.

## Not decided yet

- Android framework (native Kotlin with Amplify vs. cross-platform).
- How the LLM Q&A queries data (generated SQL vs. predefined query functions).
- Whether to split expenses between several payers (not in v1).
- Which OpenAI models to use for receipt images and for Q&A.
- For production on Neon: pooled or direct connection at runtime.
