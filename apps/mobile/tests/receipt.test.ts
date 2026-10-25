import { describe, it, expect } from "vitest";
import { canRetryReceipt, parseSuggestionParam, receiptErrorMessage, ReceiptUploadError, suggestionToFormDefaults } from "../src/lib/receipt";
import { ApiError } from "../src/api/errors";
import { parseAmount } from "../src/lib/money";
import type { ReceiptSuggestion } from "../src/api/types";

const household = { defaultCurrency: "ILS" as const };
const TODAY = "2026-10-16";
const full: ReceiptSuggestion = {
  isReceipt: true,
  name: "Shufersal",
  amount: 12345,
  currency: "EUR",
  date: "2026-10-14",
  categoryId: 1,
  description: "Milk, bread",
};

describe("suggestionToFormDefaults", () => {
  it("copies every read field; the amount is shown as a decimal that parses back to the same minor units", () => {
    const d = suggestionToFormDefaults(full, household, TODAY, [1, 2]);
    expect(d).toEqual({ name: "Shufersal", amount: "123.45", currency: "EUR", date: "2026-10-14", categoryId: 1, description: "Milk, bread" });
    expect(parseAmount(d.amount)).toBe(12345);
    expect(suggestionToFormDefaults({ ...full, amount: 7 }, household, TODAY, [1]).amount).toBe("0.07");
    expect(suggestionToFormDefaults({ ...full, amount: 2147483647 }, household, TODAY, [1]).amount).toBe("21474836.47");
  });

  it("null fields fall back: empty text, the household's currency, today, no category", () => {
    const empty: ReceiptSuggestion = { isReceipt: true, name: null, amount: null, currency: null, date: null, categoryId: null, description: null };
    expect(suggestionToFormDefaults(empty, household, TODAY, [1])).toEqual({
      name: "",
      amount: "",
      currency: "ILS",
      date: TODAY,
      categoryId: null,
      description: "",
    });
  });

  it("drops a category the form doesn't offer (archived since) and a date after today", () => {
    const d = suggestionToFormDefaults({ ...full, categoryId: 99, date: "2026-10-17" }, household, TODAY, [1, 2]);
    expect(d.categoryId).toBeNull();
    expect(d.date).toBe(TODAY);
    expect(suggestionToFormDefaults({ ...full, date: TODAY }, household, TODAY, [1]).date).toBe(TODAY);
  });

  it("ignores an amount that isn't a positive integer", () => {
    for (const amount of [0, -5, 1.5]) expect(suggestionToFormDefaults({ ...full, amount }, household, TODAY, [1]).amount).toBe("");
  });
});

describe("parseSuggestionParam", () => {
  it("round-trips a suggestion", () => {
    expect(parseSuggestionParam(JSON.stringify(full))).toEqual(full);
  });
  it("missing, malformed or not a receipt reads as no suggestion", () => {
    for (const raw of [undefined, "", "not json", "null", "[]", "5", JSON.stringify({ ...full, isReceipt: false }), ["a"]])
      expect(parseSuggestionParam(raw)).toBeNull();
  });
  it("keeps only well-typed fields", () => {
    const raw = JSON.stringify({ isReceipt: true, name: 5, amount: "100", currency: "XYZ", date: "16/10/2026", categoryId: 1.5, description: "" });
    expect(parseSuggestionParam(raw)).toEqual({ isReceipt: true, name: null, amount: null, currency: null, date: null, categoryId: null, description: null });
  });
});

describe("receiptErrorMessage", () => {
  it("maps each failure to a friendly message", () => {
    expect(receiptErrorMessage(new ApiError(502, "Couldn't read the receipt"))).toBe("Couldn't read the receipt. Try again, or enter the expense manually.");
    expect(receiptErrorMessage(new ApiError(0, "x"))).toBe("Can't reach the server. Check your connection and try again.");
    expect(receiptErrorMessage(new ApiError(429, "Daily receipt limit reached"))).toBe("You've used today's 3 receipt scans. Enter the expense manually, or scan again tomorrow.");
    expect(receiptErrorMessage(new ApiError(429, "Daily receipt limit reached"), true)).toBe("You've used today's 10 receipt scans. Enter the expense manually, or scan again tomorrow.");
    expect(receiptErrorMessage(new ApiError(404, "Receipt not found"))).toBe("Upload expired, try again.");
    expect(receiptErrorMessage(new ReceiptUploadError())).toBe("The photo couldn't be uploaded. Check your connection and try again.");
    expect(receiptErrorMessage(new ApiError(400, "Receipt image is too large"))).toBe("That photo is too large. Try another one.");
    expect(receiptErrorMessage(new ApiError(401, "Your session has ended. Please log in again."))).toBe("Your session has ended. Please log in again.");
  });
  it("anything else gets the generic message, never the raw error", () => {
    const generic = "Something went wrong reading the receipt. Please try again.";
    expect(receiptErrorMessage(new ApiError(404, "Household not found"))).toBe(generic);
    expect(receiptErrorMessage(new ApiError(500, "Internal server error"))).toBe(generic);
    expect(receiptErrorMessage(new Error("https://bucket.s3/receipts?X-Amz-Signature=secret"))).toBe(generic);
    expect(receiptErrorMessage("boom")).toBe(generic);
  });
});

describe("canRetryReceipt", () => {
  it("is false only for the daily limit", () => {
    expect(canRetryReceipt(new ApiError(429, "Daily receipt limit reached"))).toBe(false);
    expect(canRetryReceipt(new ApiError(502, "Couldn't read the receipt"))).toBe(true);
    expect(canRetryReceipt(new ReceiptUploadError())).toBe(true);
  });
});
