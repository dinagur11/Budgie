import { describe, it, expect } from "vitest";
import { askErrorMessage, buildHistory, canRetryAsk, isPremiumRequired, type ChatMessage } from "../src/lib/ask";
import { ApiError, NETWORK_ERROR_MESSAGE } from "../src/api/errors";

let id = 0;
const q = (text: string): ChatMessage => ({ id: ++id, kind: "question", text });
const a = (text: string): ChatMessage => ({ id: ++id, kind: "answer", text });
const e = (question: string): ChatMessage => ({ id: ++id, kind: "error", text: "Failed", question, canRetry: true });

describe("buildHistory", () => {
  it("is empty for a new chat", () => {
    expect(buildHistory([])).toEqual([]);
  });

  it("keeps answered questions and their answers, oldest first", () => {
    expect(buildHistory([q("How much on groceries?"), a("100.00 ILS"), q("And last month?"), a("80.00 ILS")])).toEqual([
      { role: "user", content: "How much on groceries?" },
      { role: "assistant", content: "100.00 ILS" },
      { role: "user", content: "And last month?" },
      { role: "assistant", content: "80.00 ILS" },
    ]);
  });

  it("leaves out failed questions, error bubbles and a trailing unanswered question", () => {
    expect(buildHistory([q("Failed one"), e("Failed one"), q("Hi"), a("Hello"), q("Pending")])).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("keeps only the last 10 messages", () => {
    const chat = Array.from({ length: 8 }, (_, i) => [q(`q${i}`), a(`a${i}`)]).flat();
    const history = buildHistory(chat);
    expect(history).toHaveLength(10);
    expect(history[0]).toEqual({ role: "user", content: "q3" });
    expect(history[9]).toEqual({ role: "assistant", content: "a7" });
  });

  it("trims and cuts long answers to the backend's 2000 characters, and drops empty ones", () => {
    const history = buildHistory([q("Long?"), a(` ${"x".repeat(2500)} `), q("Empty?"), a("   ")]);
    expect(history[1].content).toHaveLength(2000);
    expect(history).toHaveLength(3);
  });
});

describe("ask errors", () => {
  it("recognizes the backend's premium 403", () => {
    expect(isPremiumRequired(new ApiError(403, "Premium required"))).toBe(true);
    expect(isPremiumRequired(new ApiError(403, "Owner access required"))).toBe(false);
    expect(isPremiumRequired(new Error("Premium required"))).toBe(false);
  });

  it("maps errors to the bubble's message", () => {
    expect(askErrorMessage(new ApiError(0, "x"))).toBe(NETWORK_ERROR_MESSAGE);
    expect(askErrorMessage(new ApiError(429, "Too many questions, try again later"))).toBe("Too many questions, try again later");
    expect(askErrorMessage(new ApiError(502, "Couldn't answer the question"))).toBe("Couldn't answer the question. Try again.");
    expect(askErrorMessage(new ApiError(400, "Question must be 1-500 characters"))).toBe("Question must be 1-500 characters");
    expect(askErrorMessage(new ApiError(500, "Internal"))).toBe("Something went wrong. Please try again.");
    expect(askErrorMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });

  it("offers Retry except over the rate limit, for bad input or a signed-out session", () => {
    expect(canRetryAsk(new ApiError(0, ""))).toBe(true);
    expect(canRetryAsk(new ApiError(502, ""))).toBe(true);
    expect(canRetryAsk(new ApiError(500, ""))).toBe(true);
    expect(canRetryAsk(new Error("x"))).toBe(true);
    for (const status of [400, 401, 403, 429]) expect(canRetryAsk(new ApiError(status, ""))).toBe(false);
  });
});
