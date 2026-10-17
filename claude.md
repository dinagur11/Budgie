# Budgie

Android app for tracking household expenses. Users log expenses manually or by photographing a receipt (an LLM suggests a category), set up recurring expenses, ask an LLM questions about their spending in plain English, and generate monthly reports. Expenses belong to a household that several users share.

The data model and API were planned by the developer step by step. Respect the decisions below, and ask before changing them.

## Repo layout

```
Budgie/
  apps/
    api/                TypeScript backend (all backend work happens here)
      prisma/           schema.prisma, migrations/ (init, add_expense_name, recurring_rules_rework), seed.ts
      prisma.config.ts  Prisma 7 config (datasource URL, seed command)
      generated/prisma/ generated client (gitignored, recreate with `npx prisma generate`)
      src/
        config.ts       env loading, fails fast on missing vars
        prisma.ts       shared PrismaClient (driver adapter)
        app.ts          Express app (no listen)
        server.ts       starts the server
        lib/validate.ts input validators (see Validation)
        lib/llm/        receiptExtractor.ts (the OpenAI call for receipt images)
        lib/cursor.ts   expense list cursor: encode and decode side by side (see Expenses)
        routes/         householdsRouter.ts (households and invites), meRouter.ts
        services/       householdsService.ts, invitesService.ts, meService.ts, categoriesService.ts, expensesService.ts, recurringRulesService.ts, receiptsService.ts, projectionService.ts, calendarService.ts, summaryService.ts
        middleware/     errorHandler.ts (HttpError), auth.ts (requireAuth), household.ts (requireMember, requireOwner)
    mobile/             React Native app (Expo, Expo Router, TypeScript); see Mobile
      app/              routes: _layout.tsx (fonts, splash, session gate), (auth)/ welcome (signed-out home), login, register, confirm, forgot-password; (tabs)/ (home)/ (Expenses tab stack: index = households list, household/[id] = one household), members, analytics, settings; create-household, create-expense, scan-receipt, coming-soon
      src/              config.ts, theme.ts, auth/, api/ (client, types, hooks, receiptScan), household/ (selected household), components/, home/ (household list card, household screen cards), lib/ (money, dates, validate, categoryColors, receipt), fixtures/ (fixture mode)
      tests/            Vitest unit tests for the pure modules
      design/home.html  the Tailwind mock of the home screen (visual reference only)
```

Run npm and Prisma commands for the backend from `apps/api`, and npm / Expo commands for the app from `apps/mobile` (two separate npm projects, no workspaces).

## Stack

- **Mobile:** React Native with Expo (SDK 57) and TypeScript, Android first (see Mobile).
- **Backend:** TypeScript, Express 5 (async errors reach the error handler automatically), ESM (`"type": "module"`, run with `tsx` in dev; use `.js` extensions in relative imports).
- **Database:** PostgreSQL 16. Development uses a local Docker container; **Neon** will host production later. Prisma **7** with the `pg` driver adapter. **Pin Prisma to 7.x** (and `pg@8`). Prisma 8 (rc) has a different CLI and is not used here.
- **Auth:** AWS Cognito, region `eu-central-1`. The app has its **own login/registration screens** (Amplify/Cognito SDK, SRP flow), not the hosted UI. The app sends the **ID token** as `Authorization: Bearer <token>`; the backend verifies it with `aws-jwt-verify`. Email and password changes happen only through Cognito, never through our API.
- **Files:** AWS S3 for receipt images (temporary only; see Receipts).
- **LLM:** the **OpenAI API** for reading receipts (built, model `gpt-5.4-mini`) and spending Q&A (not built yet). The key stays on the backend only.
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

Environment variables (`apps/api/.env`, all required except `PORT`): `DATABASE_URL`, `AWS_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `S3_BUCKET` (the receipts bucket, `config.s3ReceiptsBucket`), `OPENAI_API_KEY`, `OPENAI_RECEIPT_MODEL` (the model that reads receipt images: `gpt-5.4-mini`), optional `PORT`. AWS credentials come from the SDK's default provider chain.

Schema changes always go through a new `prisma migrate dev --name <change>`. Never edit an existing migration. The history is currently the `init` migration (with a hand-written index appended, see Categories), then `add_expense_name` and `recurring_rules_rework` (drops `RecurringRule.dayOfMonth`). Prisma cannot model that expression index, so a later `migrate dev` may try to drop it: delete that DROP line from the generated SQL.

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

**Recurring rules** (implemented in `services/recurringRulesService.ts`)
- `Frequency`: `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `YEARLY`. A rule is a template (name, amount, currency, category, payer, `createdBy`) plus a schedule (`startDate`, optional `endDate`, nullable `nextOccurrence`; null means the rule has ended). There is no `dayOfMonth` (dropped in `recurring_rules_rework`) and no skip table.
- The anchor day is always `startDate`'s UTC day. Monthly and yearly occurrences are clamped against the anchor, never against the previous occurrence (Jan 31 -> Feb 28 -> Mar 31; a yearly Feb 29 gives Feb 28 in other years). Helper: `nextOccurrenceAfter`.
- A rule has one name, amount, currency, category and payer for all its expenses: changing any of them on the rule changes every expense of the rule, past ones included (`updateMany`, scoped by household and rule). Only `description` is editable on a single recurring expense.
- `startDate` can't be in the future (household time zone, `assertNotFutureDate`), on create and on edit, so a rule always backfills up to today. `endDate` must be on or after `startDate`.
- Editing `startDate` or `frequency` deletes all the rule's expenses and regenerates them (per-expense descriptions are lost; the app warns first). Changing `endDate` deletes the expenses after it (when set), recomputes `nextOccurrence` (the first occurrence after the last remaining expense, or null past `endDate`) and generates what is due.
- Create requires `currency` (`validCurrency`), like expenses; no fallback to the household's `defaultCurrency`.
- Limits (constants in `recurringRulesService.ts`): `MAX_RULES_PER_HOUSEHOLD = 20` (ended rules count, `409 "Rule limit reached"`), `MAX_OCCURRENCES_PER_RULE = 600`, `NEARING_LIMIT_AT = 540`. On create and edit, the schedule from `startDate` to `endDate` (or to today when open-ended) may have at most 600 occurrences (`400 "Rule would create too many expenses"`).
- **Generator** (`generateDueExpenses(householdId)`, lazy, no cron): finds the household's rules with `nextOccurrence <= today` (household time zone) and, one transaction per rule, locks the rule row, re-reads it, inserts every occurrence up to today and `endDate` with `createMany({ skipDuplicates: true })` (safe thanks to `@@unique([recurringRuleId, date])`), copying the rule's fields, with no active-payer check, then advances `nextOccurrence` (null past `endDate`). Idempotent. It runs before rule create, edit, list and get, and before the expense list, the calendar, the summary and `/me/spending` (later also reports and Q&A). The per-rule part (`generateForRule`) also runs inside the create and edit transactions.
- When an open-ended rule reaches 600 expenses, the generator stops and ends it: `endDate` = the date of its last expense (not today, so the schedule always matches its expenses and the rule stays editable), `nextOccurrence = null`. Nothing records why a rule ended; it is an ordinary ended rule. `nearingLimit` (`endDate === null && expenseCount >= 540`) lets the app warn first. No push or email notifications.
- Deleting a rule keeps its expenses by default (the foreign key is `ON DELETE SET NULL`, so they become normal expenses and `isRecurring` turns false). `?deleteExpenses=true` deletes the household's expenses for that rule and the rule in one transaction.
- Locks: create locks the household row (`lockHousehold`), then counts and inserts. Edit, delete and the generator lock the rule row (`lockRule`, `SELECT … FOR UPDATE`, scoped by household id). Edit doesn't need the household row, so it locks only the rule. Lock order is household first, then rule.
- If a rule's payer leaves the household, the rule (and the generator) keeps naming them; the rule's creator or an owner can change the payer.
- Indexes: `(categoryId)`, `(householdId)`, `(nextOccurrence)`.

**Receipts** (implemented in `services/receiptsService.ts`)
- No Receipt table, nothing written to the database. The flow is synchronous: the app asks for a presigned upload URL (`POST /receipts`), PUTs the JPEG straight to S3, then immediately calls `POST /receipts/analyze`; the backend downloads the image, has the LLM read it and returns a suggestion, and **deletes the image right after the analysis** (in a `finally`, success or failure). The user confirms the prefilled form in the app, which creates a normal expense. The bucket's lifecycle rule is only the backstop for images that were uploaded but never analyzed.
- Keys: `receipts/<householdId>/<uuid>.jpg` (`crypto.randomUUID()`), the household id from `req.membership`, never from the body. `validReceiptKey(key, householdId)` accepts only that pattern for the caller's household, so a household can't analyze (or delete) another's image.
- Size limit: `MAX_RECEIPT_BYTES = 5_000_000` in `validate.ts`, shared by the upload validator and the analyze step (which checks `ContentLength` and the downloaded bytes again). JPEG only (the app always re-encodes).
- Presigning: `PutObjectCommand` with `ContentType` and `ContentLength` from the request, `getSignedUrl` (`@aws-sdk/s3-request-presigner`), 300 seconds, `signableHeaders: content-type, content-length`. The SDK signs `content-length` by default but `content-type` only when listed, so both are listed: an upload with another type or size fails the signature. The shared `S3Client` uses `requestChecksumCalculation: "WHEN_REQUIRED"`; without it the SDK puts a CRC32 of an empty body into presigned PUT URLs and S3 rejects the real upload.
- Suggestion (`ReceiptSuggestion`): `{ isReceipt, name, amount, currency, date, categoryId, description }`, every field nullable; the service validates the model's answer field by field (name up to 100 characters, amount in minor units 1 to 2147483647, a `Currency` value, a real date not after the household's today, a usable category id, description up to 500 characters) and turns anything else into `null`. Not a receipt, or neither a name nor an amount read, returns `NOT_A_RECEIPT` (`isReceipt: false`, all other fields null).
- IAM for the backend's AWS credentials: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/receipts/*`, and `s3:ListBucket` on the bucket (without it a missing object reads as `403` instead of `404`, and analyze would answer `500` instead of `404 "Receipt not found"`).
- No rate limiting yet (planned as a separate task); every analyze call costs an OpenAI request.

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
| `GET /:id/members` | member | Ordered by `joinedAt`: `[{ userId, name, role, joinedAt, isActive }]` (`joinedAt` is an ISO timestamp, reset when a former member rejoins; `isActive` is true when `leftAt` is null). Active members only by default; `?includeFormer=true` also returns members who left or were removed (`false` is also accepted; any other value or a repeated parameter returns `400 "includeFormer must be true or false"`). The caller must be an active member. Never includes emails. The app uses `includeFormer=true` as a name lookup, to gray out departed users and filter expenses by them. |
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
| `POST /` | member | Body `{ name, amount, currency, date, categoryId, paidById, description? }`. `currency` is required (`validCurrency`, `400` if missing or invalid); there is no fallback to `defaultCurrency`. `createdById` is the caller. `201` with the expense shape. `400 "Invalid category"` (archived, another household's or missing), `400 "Invalid payer id"` (not an active member), `400 "Date can't be in the future"`. |
| `GET /` | member | Newest first (`date` desc, then `id` desc). Optional query: `from`, `to` (`YYYY-MM-DD`, inclusive; `from` must not be after `to`), `categoryId`, `paidById` (any user id, so filtering by someone who left works), `limit` (1 to 100, default 50), `cursor`. A repeated or invalid parameter is `400`. `200` `{ items: [expense shape], nextCursor, totalCount }`. `totalCount` is the number of expenses matching the filters, ignoring the cursor, so it is the same on every page (it can change between requests if expenses are added or deleted). Due recurring expenses are generated first (`generateDueExpenses`). |
| `GET /:expenseId` | member | `200` with the expense shape. `404 "Expense not found"` for another household's expense or a missing id. |
| `PATCH /:expenseId` | payer, creator or owner | Any subset of `{ name, amount, currency, date, categoryId, paidById, description }` (`ExpenseUpdate`). `400 "Nothing to update"` if none are given. `description`: a string sets it, `null` or an empty string clears it. A changed `paidById` must be an active member (`400 "Invalid payer id"`); a changed `categoryId` must be built-in or the household's and not archived (`400 "Invalid category"`). An unchanged payer or category is never rechecked, so an expense can keep a payer who left or a category archived since. A given `date` must not be in the future. `200` with the expense shape. |
| `DELETE /:expenseId` | payer, creator or owner | `204`, empty body. |

- `:expenseId` is checked with `validId` (`400 "Invalid id"`). Every query is scoped by the household id from `req.membership`.
- **Permission:** only the expense's current payer, its creator or an owner may update or delete it. Anyone else gets `403 "Only the payer, the creator or an owner can change this expense"`. This is intended: any member can enter an expense on someone else's behalf (`paidById` is another member), and the creator keeps edit and delete rights, even after the payer changes. Changing the payer gives the new payer the payer's right and takes it from the old one.
- **Recurring expenses** (`recurringRuleId` not null): `DELETE` returns `409 "Recurring expenses can't be deleted; end the rule instead"`. `PATCH` may change only `description`; a body with any of `name`, `amount`, `currency`, `date`, `categoryId` or `paidById` returns `409 "Only the description can be changed on a recurring expense"` (change those on the rule).
- Order of checks on `PATCH` and `DELETE`: the router's validation (`400`), then `404` (not in this household), `403` (permission), `409` (recurring), then the category, payer and date checks (`400`).
- **Pagination:** keyset on `(date, id)`, never offset. The service fetches `limit + 1` rows to know whether there is a next page, and runs the count alongside the page query (`Promise.all`). The cursor is opaque to the app and lives in `lib/cursor.ts` (`encodeExpenseCursor` / `decodeExpenseCursor`): base64url of `YYYY-MM-DD:id:fingerprint`, the last row's date and id plus a short SHA-256 fingerprint of the household id and the active filters (`householdId`, `from`, `to`, `categoryId`, `paidById`; not `limit`, which may change between pages). A cursor is tied to its household and its filters: one from another household's list, or reused with other filters, is rejected. Cursors are opaque but not signed: the app could build one, which is harmless because a cursor only sets a starting `(date, id)` and every query stays scoped to the caller's household. `nextCursor` is `null` on the last page. Pass it back as `?cursor=` with the same filters (in any order). The router decodes and validates it and passes `{ date, id }` to the service. A malformed cursor is `400 "Invalid cursor"` (checked first); a cursor issued for different filters is `400 "Cursor doesn't match the filters"`.
- Shared checks: `assertActivePayer` (single-row membership lookup with `leftAt` null, `400 "Invalid payer id"`) and `assertUsableCategory` (built-in or the household's, not archived, `400 "Invalid category"`) in `expensesService.ts`, used by both `POST` and `PATCH`, in the same order: category first, then payer (so a request with both wrong reports `"Invalid category"` on both routes).
- Accepted races (no transaction or lock around the checks): a payer leaving, or a role change, between the checks and the write is allowed, because an expense paid by someone who left is a valid state. The category case is enforced by the foreign key: a category deleted during an update gives `400 "Invalid category"` (P2003), or the category delete returns `409`. A concurrent delete of the expense during an update gives `404` (P2025).

**Recurring rules** (`/households/:id/rules`, in `services/recurringRulesService.ts`)

Rule shape (`ruleSelect` plus `toRuleResponse`, explicit fields only, never `householdId`, `createdAt` or `updatedAt`): `{ id, name, amount, currency, frequency, startDate, endDate, nextOccurrence, paidById, createdById, categoryId, expenseCount, nearingLimit }`. Dates are `YYYY-MM-DD`; `endDate` and `nextOccurrence` can be null.

| Method and path | Who | Behavior |
|---|---|---|
| `POST /` | member | Body `{ name, amount, currency, frequency, startDate, endDate?, paidById, categoryId }`. The router rejects `endDate < startDate` (`400 "End date must be on or after start date"`). One transaction: lock the household (`404 "Household not found"`), `409 "Rule limit reached"` at 20 rules, `assertUsableCategory` then `assertActivePayer`, start date not in the future, occurrence cap, insert with `nextOccurrence = startDate`, backfill up to today. `201` with the rule shape. |
| `GET /` | member | All rules, ended included, `createdAt` desc then `id` desc, no pagination. `?activeOnly=true` returns only rules with a `nextOccurrence`; `false` is also accepted; any other value or a repeated parameter is `400 "activeOnly must be true or false"`. `200 [rule shape]`. |
| `GET /:ruleId` | member | `200` rule shape. `404 "Rule not found"` for another household's rule or a missing id. |
| `PATCH /:ruleId` | payer, creator or owner | Any subset of `{ name, amount, currency, frequency, startDate, endDate, paidById, categoryId }` (`RuleUpdate`); `endDate: null` clears it. `400 "Nothing to update"` if none. Changing `paidById` is allowed only to the creator or an owner (`403 "Only the creator or an owner can change the payer"`), so a rule whose payer left can be fixed. A changed payer must be active (`400 "Invalid payer id"`), a changed category usable (`400 "Invalid category"`); unchanged ones are never rechecked. Then the date checks and the occurrence cap on the resulting schedule. `200` rule shape. |
| `DELETE /:ruleId` | payer, creator or owner | `?deleteExpenses=true` / `false` / missing; anything else or a repeated parameter is `400 "deleteExpenses must be true or false"`. `204`. |

- `:ruleId` is checked with `validId`. Every query is scoped by the household id from `req.membership`.
- Order of checks on `PATCH` and `DELETE` (same as expenses): the router's validation (`400`), `404`, `403` (`"Only the payer, the creator or an owner can change this rule"`), then the business checks (`400` / `409`).

**Calendar** (`/households/:id/calendar`, in `services/calendarService.ts`)

The app shows a month calendar with real expenses and the future occurrences of recurring rules. Future occurrences are never expense rows (see Expenses: no future dates), so the calendar has its own endpoint; the expense list stays real rows only.

| Method and path | Who | Behavior |
|---|---|---|
| `GET /?month=YYYY-MM` | member | `month` is required (`validMonth`); missing, repeated or malformed is `400 "Invalid month"`. Runs the lazy catch-up (`generateDueExpenses`) first. `200` `{ month, expenses, projected }`. Writes nothing else. |

- `expenses`: the household's real expenses dated inside the month (inclusive), in the expense shape (`expenseSelect` plus `toExpenseResponse`), ordered by `date` asc then `id` asc. No pagination.
- `projected`: future occurrences of active rules, `{ ruleId, name, amount, currency, date, categoryId, paidById, isProjected: true }`, ordered by `date` asc then `ruleId` asc. No expense id. This is the only place a rule id is returned next to an expense-like item; the app needs it to open the rule, which is the only way to change a recurring expense.
- Projection rules (`projectMonth` in `services/projectionService.ts`, shared with the summary so the two can never disagree): only rules with `nextOccurrence` not null; start from `nextOccurrence` and step with the exported `nextOccurrenceAfter` (anchor day from `startDate`, clamped), the same helper as the generator; stop after the month's last day or after `endDate` (never project past it). Only dates after today (household `timeZone`) and inside the month: today is never projected, because the catch-up already made it a real expense. A past month has `projected: []`; a future month usually has `expenses: []`. Projections are computed only, never written.
- At most 20 rules and about 31 days per month, so no pagination.

**Summary** (`/households/:id/summary`, in `services/summaryService.ts`)

| Method and path | Who | Behavior |
|---|---|---|
| `GET /?month=YYYY-MM` | member | `month` is required (`validMonth`); missing, repeated or malformed is `400 "Invalid month"`. Runs the lazy catch-up (`generateDueExpenses`) first. `200` `{ month, totals }`, `totals` = `[{ currency, spent, projected }]`. Writes nothing else. |

- `spent`: the sum of the household's real expenses dated inside the month (inclusive, today included), per currency, computed in the database (`groupBy` on `currency`, `_sum` of `amount`).
- `projected`: the per-currency sum of the items from `projectMonth`, the same function and items as the calendar's `projected` list. There is no second projection calculation.
- Amounts are integers in minor units; no formatting and no currency conversion (the app builds strings such as "4000 ILS and 220 EUR"). A sum can pass 2147483647 (Postgres sums an `Int` column as `bigint`); it is returned as a plain JSON number, never cast back to 32 bits.
- The household's `defaultCurrency` is always present (zeros when there is nothing); any other currency only when its `spent` or `projected` is not zero. Order: `defaultCurrency` first, then the others alphabetically by code.
- A past month has `projected: 0` everywhere; a future month usually has `spent: 0`. Never `householdId` or anything beyond the listed fields.

**Receipts** (`/households/:id/receipts`, in `services/receiptsService.ts`)

| Method and path | Who | Behavior |
|---|---|---|
| `POST /` | member | Body `{ contentType, byteSize }`: `contentType` exactly `"image/jpeg"` (`400 "Invalid content type"`), `byteSize` an integer from 1 to 5,000,000 (`400 "Invalid size"`). `createReceiptUpload` makes a fresh key and presigns a PUT. `200` `{ key, uploadUrl, expiresAt }` (`expiresAt` ISO, 300 seconds). Writes nothing. |
| `POST /analyze` | member | Body `{ key }` (`validReceiptKey`, `400 "Invalid key"`, including another household's key). `analyzeReceipt` downloads, reads and deletes the image. `200` with the suggestion shape. `404 "Receipt not found"` (never uploaded, expired or already analyzed: every analysis deletes the image, so a key works once), `400 "Invalid image"` (empty object), `400 "Receipt image is too large"`, `502 "Couldn't read the receipt"` (the model call failed; only the error's name is logged, never the image or the answer). |

The upload request to `uploadUrl` goes straight to S3 (no Authorization header; the signature is in the URL) and must send `Content-Type: image/jpeg` and exactly `byteSize` bytes. Never log the upload URL, its signature or image data.

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
| `GET /spending?month=YYYY-MM` | What the caller paid in the month: `200` `{ month, totals: [{ currency, spent }], households: [{ householdId, name, totals: [{ currency, spent }] }] }`. `month` is required (`validMonth`; missing, repeated or malformed is `400 "Invalid month"`). |

- `/me/spending` (`getMySpending` in `meService.ts`): sums the expenses with `paidById` = the caller (not `createdById`), dated inside the month, in the households where the caller is an active member (households they left are not counted), per currency in the database (`groupBy`, `_sum`). Runs `generateDueExpenses` for each of those households first, one at a time. Only non-zero currencies, ordered alphabetically by code; `totals: []` when there is nothing. `households` lists every active household of the caller in `joinedAt` order (like `GET /me/households`), each with the same kind of `totals` for that household (`[]` when the caller paid nothing there); one `groupBy` on `householdId` and `currency` gives both, the overall `totals` adding up the households' rows. No projections, no conversion; sums can pass 2147483647 and are returned as plain numbers. The month is the client's (the app uses the device's time zone); expense dates are calendar dates, so no time zone is applied on the server.

## API conventions

- Status codes: `400` validation errors, `400 "Invalid id"` for a malformed household id (not a positive integer up to 2147483647), checked before any membership lookup, `400` / `413` / `415` for a malformed, oversized or unsupported request body, `401` missing or invalid token, `403` a member calling an owner-only route, `404` for a non-member of an existing household or someone who left (existence is not revealed), `404` for a member who is not found on leave or remove.
- Categories: `403` for changing or deleting a built-in, `404` for a category of another household or a missing one (same response for both), `409` for a duplicate name or for deleting a category that is in use. The picker excludes archived categories unless `?includeArchived=true`.
- Recurring rules: `400` for invalid input, a future start date, an end date before the start date, an invalid category or payer, or a schedule over 600 occurrences; `403` when the caller isn't the payer, the creator or an owner, or a payer changes the payer; `404 "Rule not found"` for another household's rule or a missing one (same response for both); `409 "Rule limit reached"` at 20 rules.
- Expenses: `400` for invalid input, a future date, an invalid category or payer, or a bad list parameter or cursor; `403` when the caller isn't the payer, the creator or an owner; `400 "Cursor doesn't match the filters"` for a cursor reused with other filters; `404 "Expense not found"` for another household's expense or a missing one (same response for both); `409` for deleting a recurring expense or changing a field that is fixed on it.
- Deleting a category runs in a transaction: it first checks that the category belongs to the caller's household (so nobody can lock a built-in or another household's category), then locks the category row (`lockCategory`, `SELECT … FOR UPDATE`), then checks for expenses and recurring rules that use it; the foreign key is the final guard. A concurrent expense insert either completes first (the delete returns `409`) or fails on the foreign key after the delete.
- Lock order: the household row first, then the category row. `createCategory` locks the household row (`lockHousehold`); `deleteCategory` locks only the category row (`lockCategory`). No transaction takes both today; one that does must follow this order.
- `currency` is always sent explicitly on create (expenses, and recurring rules once built); the backend never falls back to `defaultCurrency`, which only pre-fills the form in the app.
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
- `validMonth`: strict `YYYY-MM` string, month 01 to 12, years 2000 to 2100, otherwise `HttpError(400, "Invalid month")`. Returns `{ first, last }`, the month's first and last day at UTC midnight.
- `validDescription`: string, trimmed, at most 500 characters; an empty result becomes `undefined`.
- `validReceiptContentType`: exactly `"image/jpeg"`, otherwise `HttpError(400, "Invalid content type")`.
- `validReceiptSize`: a JSON integer from 1 to `MAX_RECEIPT_BYTES` (5,000,000), otherwise `HttpError(400, "Invalid size")`.
- `validReceiptKey(value, householdId)`: `receipts/<householdId>/<lowercase uuid>.jpg`, at most 200 characters, otherwise `HttpError(400, "Invalid key")`.
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
- Receipts: mock `getSignedUrl` from `@aws-sdk/s3-request-presigner` (no real AWS or OpenAI calls); shape, the presigned command's input, keys per household passing `validReceiptKey`, validation, auth, nothing written (`tests/receipts.test.ts`).
- Categories: create, list, rename, archive and delete; case-insensitive duplicates against the household, its archived categories and the built-ins; `includeArchived` parsing; `403` for built-ins, `404` for another household's or a missing category; `409` for deleting a used category (expenses or rules, archived or not); concurrent creates and renames (never `500`); a delete racing an expense insert (never an orphan); no `householdId` or other household's data in any response.

When finished, give a short report: tests written, tests passing, and a list of every failure or suspicious behavior with the details described above.

## Secrets

Never read, open, print or commit `.env` files or any API keys, tokens or connection strings. If a value is needed, ask the developer. Variable names are documented in `apps/api/.env.example` (names only). `.env` stays in `.gitignore`.

## Mobile (`apps/mobile`)

- **Stack:** Expo SDK 57, Expo Router (file-based, routes in `app/`), TypeScript strict, React Query, `aws-amplify` v6 (Cognito only) with `@aws-amplify/react-native`, AsyncStorage, Plus Jakarta Sans and Inter via `@expo-google-fonts`, `@expo/vector-icons` (MaterialIcons stand in for the mock's Material Symbols), `react-native-svg` (the analytics donut; native code, so adding it needed a new development build), `expo-image-picker`, `expo-image-manipulator` and `expo-file-system` (receipt scanning; native code too). Styling is plain `StyleSheet` from `src/theme.ts` (colors, fonts, type scale, radii, spacing, shadows); no NativeWind, no blur. Portrait, light mode, Android only for now.
- **Development build, not Expo Go:** `@aws-amplify/react-native` has native code, so the app runs as a development build (`expo-dev-client`). Android SDK and a JDK are needed for local builds; `android/` is generated (gitignored), never edited by hand.
- **npm:** `package.json` pins `react-dom` with `overrides` (19.2.3, matching `react`); without it a fresh `npm install` fails on a peer conflict (Expo 57 pins `react@19.2.3`, `react-dom@latest` wants `^19.3.1`). Add libraries with `npx expo install <pkg>` (SDK-compatible versions).
- **Commands (from apps/mobile):** `npx expo run:android` (build, install and start on an emulator or device; also `npm run android`), `npx expo start` (dev server for an installed build), `npx vitest run` (unit tests), `npx tsc --noEmit` (type-check).
- **Env** (`apps/mobile/.env`, names in `.env.example`, gitignored): `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_COGNITO_USER_POOL_ID`, `EXPO_PUBLIC_COGNITO_CLIENT_ID`. The region is the constant `eu-central-1`. `src/config.ts` reads each one literally (Expo inlines `EXPO_PUBLIC_*` at build time) and throws on a missing one. These values are bundled into the app, so never put secrets in them. An Android emulator reaches the host at `http://10.0.2.2:<port>`; a physical device needs the computer's LAN IP.
- **Auth:** own screens (no hosted UI), Amplify's default SRP sign-in, email as the Cognito username. The pool requires an emailed 6-digit code and uses Cognito's default password policy (8+ characters, lower, upper, number, symbol), mirrored in `src/lib/validate.ts`. Sign-up sends the `name` and `email` attributes with `autoSignIn`, so confirming the code right after registering signs in; otherwise the user goes back to log in. A login with an unconfirmed account resends the code and opens the confirm screen. Forgot password (`app/(auth)/forgot-password.tsx`, "Forgot password?" on the login screen, which passes the typed email): one screen in two steps, the email (`resetPassword`, Cognito emails a 6-digit code), then the code and a new password with confirmation (`confirmResetPassword`, same policy as registering) and a resend with a 30-second cooldown; Cognito doesn't sign in after a reset, so it returns to login with `?reset=1` and a success banner. It never reveals whether an account exists: an unknown email still moves on to the code step, and `UserNotFoundException` on confirm reads as a wrong code (`authErrorMessage(e, "resetPassword")`). Cognito errors go through `src/auth/errors.ts`; wrong password and unknown user read the same.
- **Session gate:** `SessionProvider` (`src/auth/session.tsx`, `useSession()`) holds `loading` / `signedIn` / `signedOut` (from `getCurrentUser()` and Amplify Hub events). The root layout keeps the splash up while fonts load and the session is checked, then shows `(tabs)` or `(auth)` through `Stack.Protected`, so sign-in, sign-out and a 401 redirect by themselves. A signed-out user lands on `welcome` (what Budgie does, "Create an account" and "Log in"); login, register and forgot-password open on top of it. The welcome, login, register, confirm and forgot-password screens share `AuthTop` (`src/components/AuthTop.tsx`, `Screen`'s `top`): the home screen's purple top section (rounded bottom corners, white wordmark top right, light status bar) with the screen's title and subtitle; welcome lists its features in the lighter block inside it, and the forms sit in a white card below. The Budgie wordmark (`Wordmark`) is a link home: `/` (households list) when signed in, `/welcome` when signed out. Sign-out clears the React Query cache.
- **API client** (`src/api/client.ts`, `apiFetch`): one fetch wrapper. Before each request it calls `fetchAuthSession()` (refresh and expiry handled there) and sends the **ID token** as `Bearer`. JSON in and out. Errors become `ApiError { status, message }` from the backend's `{ error }` body; status 0 means no answer. A 401 signs out. Tokens are never logged.
- **Data:** hooks in `src/api/hooks.ts`; every household query key starts with `["household", id]`. The selected household id is kept in AsyncStorage (`src/household/HouseholdContext.tsx`), falling back to the first of `GET /me/households`. No fixtures: summary and calendar are real endpoints. The Expenses tab opens on the **households list** (`app/(tabs)/(home)/index.tsx`, path `/`). It has **no tab bar** (`TabBar` returns null when the path is `/`; the tabs belong to an open household). At the top, `HomeTop` (`src/home/HomeTop.tsx`, passed to `Screen` as `top`): an edge-to-edge section in the secondary color under a light status bar, with rounded bottom corners: the white wordmark in the top right, "Hey <first name>!" (`GET /me`) below it, and what the user paid this month across all their households, captioned "Expenses paid by you in <month> across <n> households" (no caption without households), the amount and caption inside a lighter purple block (`GET /me/spending`, month from the device's time zone, `deviceTimeZone()` in `dates.ts`), in the same `AmountPanel` as the household screen (`bare`, first currency large; the backend orders currencies alphabetically). Then "Your households" with a `SearchField` that filters the list by name (case-insensitive, in the app). At the bottom, `HomeBar` (`src/home/HomeBar.tsx`, `Screen`'s `footer`): Settings (the account settings, not the household's), a raised "+" that opens create-household, and Profile (the profile screen, `app/profile.tsx`). Below it, every household from `GET /me/households` (each card in its own color, `householdColor(householdId)` from `categoryColors.ts`: the same 10-color palette by id, blended into white for the card's undertone, stronger on the badge, the role tag and the spent block), each card with the caller's role and its spent-so-far for the household's current month (`GET /households/:id` for the time zone, then `summary`; projected amounts are not shown there). Tapping a card selects the household and opens **`/household/[id]`**, which reads `GET /households/:id`, `summary` and `calendar` for the household's current month, `categories?includeArchived=true` and `members?includeFormer=true`. That screen has a back button and the switcher (switching changes the route's id); an id the user isn't a member of shows "Household not found". The back arrow and the Budgie wordmark return to the list. The list makes two requests per household (no batch endpoint).
- **Receipt scanning** (`app/scan-receipt.tsx`, the "+" menu's "Photograph Receipt"; `useReceiptScan` in `src/api/receiptScan.ts`; pure helpers in `src/lib/receipt.ts`): "Take photo" (`launchCameraAsync`, camera permission asked first) or "Choose from gallery" (`launchImageLibraryAsync`), both through the same steps: re-encode on the device with `expo-image-manipulator` (long side at most 1600px, JPEG at 0.7, always JPEG since camera photos can be HEIC), read the byte size (`expo-file-system/legacy` `getInfoAsync`; in SDK 57 `uploadAsync` lives under the legacy entry point), `POST /receipts` through `apiFetch`, PUT the raw bytes to `uploadUrl` with `FileSystem.uploadAsync` (`httpMethod: "PUT"`, binary content, `Content-Type: image/jpeg`; never through `apiFetch`, no Authorization header; anything but `200` is a failed upload), then `POST /receipts/analyze` right away. The temporary JPEG is deleted from the cache when done, success or failure. One loading state with stage text ("Uploading…", then "Reading receipt…"); a second scan can't start while one runs, and leaving the screen ignores the result. A receipt opens `create-expense?receipt=<suggestion JSON>` (`parseSuggestionParam`), and the form starts from `suggestionToFormDefaults`: unread fields fall back to the empty form's defaults (no currency -> the household's `defaultCurrency`, no date -> the household's today, no category -> none picked, so the user must choose); the amount shows as a decimal (`amountInput`); the payer defaults as usual; nothing is saved until the user confirms. Not a receipt: "That doesn't look like a receipt" with Retake and Enter manually. Errors (`receiptErrorMessage`: `502`, network, `429`, a failed upload, `404 "Receipt not found"` -> "Upload expired, try again") show Try again and Enter manually (the empty form); Try again redoes the whole upload and analysis, because the backend deletes the image after every analysis. Never log the upload URL, the key's signature, tokens or image data.
- **Calendar dots:** one dot per category per day (up to 3), colored by `categoryColor(categoryId)` (`src/lib/categoryColors.ts`, a fixed 10-color palette indexed by id, so colors are stable but repeat after 10 categories; checked with the dataviz palette validator, and charts always label their parts because green, amber and cyan are under 3:1 on white); filled = real expense, hollow = scheduled recurring occurrence. The legend lists the month's categories. The expense rows' category tags use the same color (tinted background and a dot), so a category looks the same in the list and on the calendar.
- **Spent panel:** on the household screen the spending card has no title; it opens with the month's spent total in a panel in the secondary color ("Spent in October so far"; the shared `src/components/AmountPanel.tsx`): the first currency large (`numeralLg`), each other one on its own line as "+ 220.00 EUR" (`spentEntries` in `money.ts`), then "Future expenses scheduled by the end of the month: …".
- **Dates and money:** dates stay `YYYY-MM-DD` strings and months `YYYY-MM`; `src/lib/dates.ts` does calendar math with plain arithmetic (never a local `Date`), and "today" is `todayInTimeZone(household.timeZone)`. Money is integer minor units; `formatMoney` (`src/lib/money.ts`) prints `1,234.50 ILS` by hand (no Intl, no symbols), and several currencies join with " and ".
- **Touch targets:** at least 44dp (`MIN_TOUCH`), through `hitSlop` where the visual is smaller.
- **Tests:** Vitest for pure modules only (`tests/`, `vitest.config.mts`): money, dates, validators, the Cognito error mapper (including the password reset), category colors, receipt suggestion mapping and error messages. No component tests yet.
- **Fixture mode:** `EXPO_PUBLIC_FIXTURES=true` (build time) makes `apiFetch` answer from `src/fixtures/fixtures.ts` (made-up household, members, categories and the current month's expenses, projections and totals) and fakes the session; no Amplify call and no network request. On web, `?fixture=home` (default; three households), `empty` (no household) or `signedOut` (the auth screens) picks the scenario. Never set it in a real build.
- **Screenshots:** the Expo web build (`react-native-web`, `react-dom`, `@expo/metro-runtime`) is used only for screenshots: `EXPO_PUBLIC_FIXTURES=true npx expo export --platform web`, serve `dist/` with an SPA fallback, and shoot with Playwright at 390x844 (Playwright is not a project dependency). Output goes to `apps/mobile/screenshots/` (gitignored). Never screenshot real credentials or tokens.

## Status

Done: schema and migrations (`init`, `add_expense_name`, `recurring_rules_rework`), seeded categories, Cognito user pool, `requireAuth`, `requireMember` / `requireOwner`, validators, the household routes and services, the `/me` routes, invites (create, list, cancel, preview, join), categories (create, list, update, delete; done and tested), members list with `?includeFormer`, expenses (create, list with filters, keyset pagination and `totalCount`, get, update, delete; no future dates; done and tested), recurring rules (create, list, get, update, delete, the lazy generator, the 20-rule and 600-occurrence limits; done and tested), the calendar (`GET /:id/calendar?month=`, real expenses plus projected rule occurrences; done and tested), the monthly summary (`GET /:id/summary?month=`, per-currency spent and projected totals, sharing `projectMonth` with the calendar; done and tested), the caller's own monthly spending across households (`GET /me/spending?month=`; done and tested), receipts (`POST /:id/receipts` presigned upload, `POST /:id/receipts/analyze` with the OpenAI extractor; the upload route is tested, analyze has no automated tests). Mobile app v1 (`apps/mobile`): Expo project, theme and shared components, a signed-out welcome screen, login, register and email-code confirmation, session gate, API client, household switcher and create-household form, the Expenses tab (households list with each household's spent-so-far; the household screen with monthly totals, the month's expenses and a mini calendar with category-colored dots), the Members tab (active members with "You", join date in the household's time zone and role; an owner can remove members and create an invite link shared through the share sheet, `budgie://join?token=…`, `src/lib/invite.ts`), the Settings tab (an owner edits name, default currency and time zone, manages the household's categories (rename, archive, delete; built-ins listed without actions, `src/settings/CategoriesCard.tsx`) or deletes the household; a member can leave), editing and removing expenses (an expanded expense row shows Edit and Remove to its payer, its creator or an owner, `canChangeExpense` in `src/lib/permissions.ts`; a recurring expense offers only "Edit description" and no Remove; `app/edit-expense.tsx?expenseId=` shares `src/expenses/ExpenseForm.tsx` with create and sends only the changed fields), a filter on the household screen's expense list ("Show: All / By category / By payer", then one of the categories or payers in that month's expenses; client-side over the month's expenses, `src/lib/expenseFilter.ts`, with the shown count and per-currency total; resets when the month changes), the create-expense and create-category screens (the "+" menu has, top to bottom, Create Expense, Photograph Receipt and Create Recurring Expense; an empty month's expense list has its own "Create expense" button; create-category opens from the expense forms' "+ New category" and the owner's category settings; the expense form picks the date on a month calendar (`DatePicker`, days after the household's today disabled) with Today / Yesterday chips, amounts parsed by `parseAmount` in `money.ts`), month browsing on the household screen (`MonthNav`: "← September" back through past months, forward up to the household's current month; the summary, expense list and calendar follow the chosen month, which resets to the current one when the household changes), the household screen's Recurring expenses card (`src/home/RecurringCard.tsx`, all rules, ended ones last, with Edit and Delete for the payer, creator or owner; Delete asks whether to keep the rule's expenses (`?deleteExpenses=false`) or delete them too; this card is the way into a rule, since expense rows don't carry a rule id), editing a rule (`app/edit-rule.tsx?ruleId=`, the same `RuleForm`, sends only the changed fields, warns before a new start date or frequency recreates the rule's expenses, payer locked unless the caller is the creator or an owner), the create-recurring-expense screen (`app/create-rule.tsx`, `src/expenses/RuleForm.tsx`, from the "+" menu: frequency chips, start date on `DatePicker` up to today, optional end date on `DatePicker` from the start date, a one-line schedule summary from `scheduleSummary` in `src/lib/recurring.ts`), the account menu (`AccountMenu`, from the header's account icon: name and email, which open the profile, and log out), a back arrow instead of the wordmark on the household tabs (Members, Analytics, Settings: `useBackToHouseholds` in `AppHeader.tsx` switches to the Expenses tab and pops its stack back to the households list with `pop: true`), the calendar card on the household screen (it doesn't open another screen), tapping a calendar day with dots (hovering, on the web) lists that day's expenses and scheduled ones by name under the grid, the profile screen (`app/profile.tsx`, Profile in the households list's bar: a month picker (`MonthNav`, device time zone), each active household with what the user paid there that month (tap to open it), what they paid in each of the last 6 months (`MonthBarChart`, one `/me/spending` request per month) and the picked month split by household (`DonutChart`, household colors); the charts are shared with Analytics in `src/analytics/`), the account settings screen (`app/account-settings.tsx`, opened by Settings in the households list's bar: change name through `PATCH /me`, change password through Amplify's `updatePassword` (Cognito only), log out), the Analytics tab (`src/analytics/`: a donut of one month's real expenses grouped by category or payer, one currency at a time, with a month picker (`MonthNav`) and a labeled legend; a bar chart of the household's spent total for the last 6 months (`useSummaries`, one summary request per month); no backend changes, grouping in `src/lib/analytics.ts`), receipt scanning (`app/scan-receipt.tsx`: photo or gallery, upload, analysis, the create-expense form prefilled from the suggestion), forgot password (`app/(auth)/forgot-password.tsx`: email, then the Cognito code and a new password).

Next: joining with an invite (the `budgie://join` screen that reads the shared link's token); backend: rate limiting for receipts (both receipt routes; still missing), spending Q&A, monthly reports (beyond the summary totals), the invite cleanup job.

## Not decided yet

- How the LLM Q&A queries data (generated SQL vs. predefined query functions).
- Whether to split expenses between several payers (not in v1).
- Which OpenAI model to use for Q&A.
- For production on Neon: pooled or direct connection at runtime.
