import { CURRENCIES, type Currency, type ReceiptSuggestion } from "../api/types";
import { ApiError } from "../api/errors";
import { amountInput } from "./money";

// the create-expense form's starting values (the strings its fields show) when it opens from a scanned receipt
export type ReceiptFormDefaults = {
  name: string;
  amount: string;
  currency: Currency;
  date: string;
  categoryId: number | null;
  description: string;
};

// A suggestion -> form defaults. Unread fields fall back to what the empty form shows: no currency means the household's
// default, no date means the household's today, no category means none picked (the user has to choose one).
// usableCategoryIds: the categories the form offers; a suggested one that isn't among them (archived since) is dropped.
export function suggestionToFormDefaults(
  s: ReceiptSuggestion,
  household: { defaultCurrency: Currency },
  today: string,
  usableCategoryIds: number[],
): ReceiptFormDefaults {
  return {
    name: s.name ?? "",
    amount: s.amount !== null && Number.isInteger(s.amount) && s.amount >= 1 ? amountInput(s.amount) : "",
    currency: s.currency ?? household.defaultCurrency,
    // the backend never suggests a future date; the check keeps the form valid if the day changed in between
    date: s.date !== null && s.date <= today ? s.date : today,
    categoryId: s.categoryId !== null && usableCategoryIds.includes(s.categoryId) ? s.categoryId : null,
    description: s.description ?? "",
  };
}

// The suggestion travels to the create-expense route as one JSON string param; anything malformed reads as no suggestion
// (the form opens empty). Only well-typed fields are kept; others become null.
export function parseSuggestionParam(raw: unknown): ReceiptSuggestion | null {
  if (typeof raw !== "string" || raw === "") return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.isReceipt !== true) return null;
  const str = (x: unknown) => (typeof x === "string" && x !== "" ? x : null);
  const int = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x >= 1 ? x : null);
  return {
    isReceipt: true,
    name: str(o.name),
    amount: int(o.amount),
    currency: typeof o.currency === "string" && (CURRENCIES as readonly string[]).includes(o.currency) ? (o.currency as Currency) : null,
    date: typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null,
    categoryId: int(o.categoryId),
    description: str(o.description),
  };
}

// the PUT to S3 answered with something other than 200
export class ReceiptUploadError extends Error {
  constructor() {
    super("Receipt upload failed");
    this.name = "ReceiptUploadError";
  }
}

// what the scan screen shows when a scan fails; every error offers "Try again" (the whole upload and analysis again,
// since the backend deletes the image after every analysis) and "Enter manually"
export function receiptErrorMessage(error: unknown): string {
  if (error instanceof ReceiptUploadError) return "The photo couldn't be uploaded. Check your connection and try again.";
  if (error instanceof ApiError) {
    if (error.status === 0) return "Can't reach the server. Check your connection and try again.";
    if (error.status === 404 && error.message === "Receipt not found") return "Upload expired, try again.";
    if (error.status === 429) return "Too many receipts at once. Wait a moment and try again.";
    if (error.status === 502) return "Couldn't read the receipt. Try again, or enter the expense manually.";
    if (error.status === 400 && error.message === "Receipt image is too large") return "That photo is too large. Try another one.";
    if (error.status === 401) return error.message;
  }
  return "Something went wrong reading the receipt. Please try again.";
}
