import { HttpError } from "../middleware/errorHandler.js";
import { Currency, Frequency } from "../../generated/prisma/client.js";

const MAX_INT = 2147483647;
const MAX_DESCRIPTION_LENGTH = 500;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
// largest receipt image accepted, in bytes (the upload's size and the analyze step's check)
export const MAX_RECEIPT_BYTES = 5_000_000;

export function optional<T>(value: unknown, validate: (v: unknown) => T): T | undefined {
  return value === undefined ? undefined : validate(value);
}

export function validName(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "Name must be a string");
  const name = value.trim();
  if (name.length < 1 || name.length > 100) {
    throw new HttpError(400, "Name must be 1-100 characters");
  }
  return name;
}

export function validCurrency(value: unknown): Currency {
  if (!Object.values(Currency).includes(value as Currency)) {
    throw new HttpError(400, "Invalid currency");
  }
  return value as Currency;
}

export function validFrequency(value: unknown): Frequency {
  if (
    typeof value !== "string" ||
    !Object.values(Frequency).includes(value as Frequency)
  ) {
    throw new HttpError(400, "Invalid frequency");
  }
  return value as Frequency;
}

export function validTimeZone(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "Time zone must be a string");
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new HttpError(400, "Invalid time zone");
  }
}

export function validId(value: unknown): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9]\d*$/.test(text))
    throw new HttpError(400, "Invalid id");

  const id = Number(text);
  if (id < 1 || id > MAX_INT)
    throw new HttpError(400, "Invalid id");
  return id;
}

export function validBoolean(value: unknown, field?: string): boolean {
  if (typeof value !== "boolean")
    throw new HttpError(400, field ? `${field} must be true or false` : "Invalid boolean value");
  return value;
}

export function validAmount(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_INT
  ) {
    throw new HttpError(400, "Amount must be a positive whole number");
  }
  return value;
}

export function validDate(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "Date must be in YYYY-MM-DD format");
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Date rolls invalid days over (2026-02-30 becomes March 2), so compare the parts back
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    year < MIN_YEAR ||
    year > MAX_YEAR
  ) {
    throw new HttpError(400, "Date is not a valid calendar date");
  }
  return date;
}

// strict YYYY-MM (month 01 to 12, years 2000 to 2100); returns the month's first and last day at UTC midnight
export function validMonth(value: unknown): { first: Date; last: Date } {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  const year = match ? Number(match[1]) : NaN;
  const month = match ? Number(match[2]) : NaN;
  if (!(year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12))
    throw new HttpError(400, "Invalid month");
  return { first: new Date(Date.UTC(year, month - 1, 1)), last: new Date(Date.UTC(year, month, 0)) };
}

export function validDescription(value: unknown): string | undefined {
  if (typeof value !== "string") {
    throw new HttpError(400, "Description must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(
      400,
      `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`
    );
  }
  return trimmed === "" ? undefined : trimmed;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function validReceiptKey(value: unknown, householdId: number): string {
  if (typeof value !== "string" || value.length > 200) {
    throw new HttpError(400, "Invalid key");
  }
  const pattern = new RegExp(`^receipts/${householdId}/${UUID}\\.jpg$`);
  if (!pattern.test(value)) {
    throw new HttpError(400, "Invalid key");
  }
  return value;
}

export function validReceiptContentType(value: unknown): "image/jpeg" {
  if (value !== "image/jpeg") throw new HttpError(400, "Invalid content type");
  return value;
}

export function validReceiptSize(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_RECEIPT_BYTES
  ) {
    throw new HttpError(400, "Invalid size");
  }
  return value;
}
