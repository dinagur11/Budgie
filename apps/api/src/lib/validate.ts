import { HttpError } from "../middleware/errorHandler.js";
import { Currency } from "../../generated/prisma/client.js";

const MAX_INT = 2147483647;

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
    throw new HttpError(400, "invalid id");

  const id = Number(text);
  if (id < 1 || id > MAX_INT)
    throw new HttpError(400, "invalid id");
  return id;
}