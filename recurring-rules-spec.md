# Recurring rules: spec for Claude Code

Read CLAUDE.md first. The developer already wrote the `POST /:id/rules` router and the date helpers (`nextMonth`, `nextYear`, `toRuleResponse`). Build the rest in the existing style (routers validate, services don't; `HttpError`; Express 5). Ask before any decision not covered here.

## 0. Decisions (final)

- `dayOfMonth` is removed. The anchor day is always `startDate`'s UTC day. Monthly and yearly occurrences are clamped against the anchor, never against the previous occurrence (Jan 31 -> Feb 28 -> Mar 31, not Mar 28).
- A rule has one name, amount, currency, category and payer for all its expenses. Changing any of them on the rule changes every expense of that rule, past ones included.
- Only `description` is editable per expense on a recurring expense.
- Editing `startDate` or `frequency` deletes all the rule's expenses and regenerates them (this wipes per-expense descriptions; the app warns first).
- `endDate` can be shortened (expenses after it are deleted) or extended.
- `startDate` cannot be in the future (household time zone, `assertNotFutureDate`), on create and on edit. This means rules always backfill up to today.
- Generation is lazy (section 4). No cron for now.
- Limits: 20 rules per household (ended rules count), 600 occurrences per rule.

## 1. Schema (new migration, e.g. `recurring_rules_rework`)

- Drop `RecurringRule.dayOfMonth`.
- Keep the existing indexes. Use `onDelete: SetNull` for `Expense.recurringRuleId` if it is not already the behavior (deleting a rule keeps its expenses by default). Check the current schema and the generated SQL; do not edit existing migrations.
- Constants in `recurringRulesService.ts`: `MAX_RULES_PER_HOUSEHOLD = 20`, `MAX_OCCURRENCES_PER_RULE = 600`, `NEARING_LIMIT_AT = 540`.

## 2. Endpoints (`/households/:id/rules`, `services/recurringRulesService.ts`)

Rule response shape, defined once (`ruleSelect` + `toRuleResponse`):

`{ id, name, amount, currency, frequency, startDate, endDate, nextOccurrence, paidById, createdById, categoryId, expenseCount, nearingLimit }`

- Dates are `YYYY-MM-DD`; `endDate` and `nextOccurrence` can be null.
- `nearingLimit` is derived: `endDate === null && expenseCount >= NEARING_LIMIT_AT`. (Once the generator ends a rule at the limit it has an `endDate`, so `nearingLimit` turns false by itself.)
- Never return `householdId`, `createdAt`, `updatedAt`. NOTE: the developer's current `toRuleResponse` spreads `...rest`, which would leak `householdId`; replace it with an explicit select.

| Method and path | Who | Behavior |
|---|---|---|
| `POST /` | member | Body `{ name, amount, currency, frequency, startDate, endDate?, paidById, categoryId }`. Router already validates. `201` with the rule shape. See create rules below. |
| `GET /` | member | All rules of the household (ended included), `createdAt` desc then `id` desc, no pagination (max 20, so the list is always small). Optional `?activeOnly=true` returns only active rules (`nextOccurrence` not null); `false` is also accepted (same as missing); any other value or a repeated parameter is `400 "activeOnly must be true or false"` (same parsing as `includeArchived` and `includeFormer`). `200 [rule shape]`. Run the lazy catch-up first, so "active" reflects today. |
| `GET /:ruleId` | member | `200` rule shape. `404 "Rule not found"` for another household's rule or a missing id. |
| `PATCH /:ruleId` | payer, creator or owner | Any subset of `{ name, amount, currency, frequency, startDate, endDate, paidById, categoryId }`. `400 "Nothing to update"` if none. `endDate: null` clears it. `200` rule shape. See edit rules below. |
| `DELETE /:ruleId` | payer, creator or owner | `?deleteExpenses=true` / `false` / missing; anything else or a repeated parameter is `400 "deleteExpenses must be true or false"`. `204`. See delete rules below. |

`:ruleId` is checked with `validId`. Every query is scoped by the household id from `req.membership`. Add `validFrequency` to `validate.ts` if it is not there yet.

Error order on PATCH and DELETE (same as expenses): router validation (400), 404, 403, then business checks (400 / 409).

Permission error: `403 "Only the payer, the creator or an owner can change this rule"`. Changing `paidById` on a rule is allowed only to the rule's creator or an owner (`403 "Only the creator or an owner can change the payer"`), so a rule whose payer left can still be fixed. A changed `paidById` must be an active member (`400 "Invalid payer id"`); a changed `categoryId` must pass `assertUsableCategory` (`400 "Invalid category"`). An unchanged payer or category is never rechecked.

### Create

One transaction:
1. Lock the household row (`lockHousehold`; `404 "Household not found"` if gone).
2. Count rules in the household; `409 "Rule limit reached"` at 20 (ended ones included).
3. `assertUsableCategory` first, then `assertActivePayer` (same order as expenses).
4. `startDate` not in the future (`400 "Date can't be in the future"`), `endDate >= startDate` (`400 "End date must be on or after start date"`).
5. Occurrence cap: if `endDate` is given, count occurrences from `startDate` to `endDate`; if not, count from `startDate` to today. More than 600 -> `400 "Rule would create too many expenses"`.
6. Insert the rule with `nextOccurrence = startDate`, then run the generator for it (backfill up to today).
7. Return the rule shape (with `_count.expenses`).

### Edit

One transaction: lock the household row only if the household is needed, then lock the rule row (`SELECT ... FOR UPDATE`, scoped by household id). Lock order is household first, then rule. Then:
- Apply the occurrence-cap check to the resulting schedule (same counting as create; `400 "Rule would create too many expenses"`). Extending `endDate` or moving `startDate` earlier can trigger it. A rule the generator ended at the limit is an ordinary ended rule: the app can't tell it apart, and an edit that passes the check works like any other.
- `startDate` in the future -> `400`. `endDate < startDate` -> `400`.
- If `startDate` or `frequency` changed: delete all the rule's expenses and set `nextOccurrence = startDate`; the generator then rebuilds them up to today.
- If `endDate` changed (and start/frequency did not): delete the rule's expenses with `date > endDate` (when set), recompute `nextOccurrence` (null if the schedule is exhausted, otherwise the first occurrence after the last existing one), then run the generator.
- If `name`, `amount`, `currency`, `categoryId` or `paidById` changed: `updateMany` on the rule's expenses (scoped by household id and rule id) with the new values.
- Return the rule shape.

### Delete

One transaction: lock the rule row (scoped by household id; `404` if gone). With `deleteExpenses=true`, delete the household's expenses for that rule, then the rule. Otherwise delete the rule only (its expenses keep their data and lose the link, so they become normal expenses and `isRecurring` becomes false).

## 3. Expense endpoint changes (`expensesService.ts`, CLAUDE.md)

For expenses with `recurringRuleId` not null:
- `DELETE` stays `409 "Recurring expenses can't be deleted; end the rule instead"`.
- `PATCH` may change only `description` (payer, creator or owner, as today). A body with any of `name`, `amount`, `currency`, `date`, `categoryId`, `paidById` returns `409 "Only the description can be changed on a recurring expense"`. Update the existing message and the 409 check accordingly.
- `isRecurring` already exists in the response and drives the "recurring" badge in the app. No new backend work.

## 4. Generator (`generateDueExpenses`)

One idempotent function, `generateDueExpenses(householdId)`, also usable per rule inside a transaction:
- Find the household's rules with `nextOccurrence <= today`, where today is the current date in the household's `timeZone` (`todayInTimeZone`).
- For each due rule: lock the rule row (`FOR UPDATE`, the same lock the edit and delete take), insert every occurrence from `nextOccurrence` up to today (and up to `endDate`) with `createMany({ skipDuplicates: true })` (the `@@unique([recurringRuleId, date])` makes it safe), copying name, amount, currency, category, payer and `createdById` from the rule. The generator inserts directly, with no active-payer check.
- Advance `nextOccurrence` using the helper with the anchor day from `startDate`; set it to null when it passes `endDate`.
- Occurrence limit: if the rule's total expenses reach 600 while it is open-ended, stop, set `endDate = today` and `nextOccurrence = null`. Nothing else is recorded (the developer chose not to track why a rule ended).
- Call it before: rule create and edit, `GET /rules`, `GET /rules/:ruleId`, and the expense list (and later reports and the LLM Q&A). Keep this in one place so no read path forgets it. A cheap pre-check (any rule with `nextOccurrence <= today`) avoids the work when nothing is due.
- Dates are UTC-midnight `Date` values for `@db.Date` columns; use the UTC methods everywhere.

## 5. Notifications

There is no notification infrastructure. For now the backend only exposes `nearingLimit` in the rule response; the app shows the warning before the cap is hit. Do not build push or email. A real notification can be added later (the invite cleanup job is a natural place for a scheduled job).

## 6. Housekeeping

- Update the "Recurring rules" section of CLAUDE.md (remove `dayOfMonth` and "not implemented yet"; add the decisions above, the new endpoints, the expense `409` message, and the limits), plus Status and Next.
- Add the rules endpoints to the API conventions list (403 / 404 / 409 meanings, `Rule not found`).
- Tests (Vitest + Supertest, per the Testing section): create / list / get / edit / delete happy paths and exact shapes (no `householdId`); validation; 404 for non-members and another household's rule; 403 for a plain member; the 20-rule cap; `Rule would create too many expenses` on create and on edit; start date in the future; backfill on create; edit of start date or frequency regenerating; end date shortened deleting later expenses; rule field changes propagating to all expenses; `deleteExpenses` true / false / invalid; the lazy generator (idempotent, concurrent calls never create duplicates or `500`, edit or delete racing the generator); month-end clamping (Jan 31, Feb 29); the limit reached on an open-ended rule; the recurring expense `PATCH` accepting only `description`.
