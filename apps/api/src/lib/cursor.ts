import { createHash } from "node:crypto";
import { HttpError } from "../middleware/errorHandler.js";
import { validDate, validId } from "./validate.js";

export type ExpenseCursorFilters = {
  householdId: number;
  from?: Date;
  to?: Date;
  categoryId?: number;
  paidById?: number;
};

export type ExpenseCursor = { date: Date; id: number };

const day = (d: Date | undefined) => (d === undefined ? "" : d.toISOString().slice(0, 10));

// short hash of the household and the active filters, so a cursor can't be reused with different ones
function filtersFingerprint(filters: ExpenseCursorFilters): string {
  const { householdId, from, to, categoryId, paidById } = filters;
  const canonical = [householdId, day(from), day(to), categoryId ?? "", paidById ?? ""].join("|");
  return createHash("sha256").update(canonical).digest("base64url").slice(0, 16);
}

// the cursor is opaque to the app: base64url of "YYYY-MM-DD:id:fingerprint" (the last row's date and id)
export function encodeExpenseCursor(date: Date, id: number, filters: ExpenseCursorFilters): string {
  return Buffer.from(`${day(date)}:${id}:${filtersFingerprint(filters)}`).toString("base64url");
}

export function decodeExpenseCursor(cursor: string, filters: ExpenseCursorFilters): ExpenseCursor {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const match = /^(\d{4}-\d{2}-\d{2}):(\d+):([A-Za-z0-9_-]{16})$/.exec(text);
  // re-encoding must give back the same string, so junk around valid base64url is rejected too
  if (match === null || Buffer.from(text).toString("base64url") !== cursor)
    throw new HttpError(400, "Invalid cursor");
  let decoded: ExpenseCursor;
  try {
    decoded = { date: validDate(match[1]), id: validId(match[2]) };
  } catch {
    throw new HttpError(400, "Invalid cursor");
  }
  if (match[3] !== filtersFingerprint(filters))
    throw new HttpError(400, "Cursor doesn't match the filters");
  return decoded;
}
