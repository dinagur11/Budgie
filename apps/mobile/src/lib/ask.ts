import { ApiError, NETWORK_ERROR_MESSAGE } from "../api/errors";
import type { AskHistoryMessage } from "../api/types";

// the backend's limits (validQuestion and validHistory in apps/api/src/lib/validate.ts)
export const MAX_QUESTION_LENGTH = 500;
export const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_CONTENT_LENGTH = 2000;

export const EXAMPLE_QUESTIONS = [
  "How much did I spend on groceries last month?",
  "Where do we spend the most?",
  "What do our recurring expenses cost per month?",
  "What was our biggest expense this year?",
];

// the chat as the Ask AI screen shows it: questions, answers and failed asks (with the question to resend)
export type ChatMessage =
  | { id: number; kind: "question"; text: string }
  | { id: number; kind: "answer"; text: string }
  | { id: number; kind: "error"; text: string; question: string; canRetry: boolean };

// The history sent with a new question: the last 10 answered exchanges' messages, oldest first. A question without an
// answer after it (it failed) and error bubbles are left out, so the model only sees questions next to their answers.
export function buildHistory(messages: ChatMessage[], max = MAX_HISTORY_MESSAGES): AskHistoryMessage[] {
  const history: AskHistoryMessage[] = [];
  messages.forEach((m, i) => {
    if (m.kind === "answer") history.push({ role: "assistant", content: m.text });
    else if (m.kind === "question" && messages[i + 1]?.kind === "answer") history.push({ role: "user", content: m.text });
  });
  return history
    .map((m) => ({ ...m, content: m.content.trim().slice(0, MAX_HISTORY_CONTENT_LENGTH) }))
    .filter((m) => m.content !== "")
    .slice(-max);
}

// the backend's 403 for a member who isn't premium: the screen shows the upsell instead of an error
export function isPremiumRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.message === "Premium required";
}

// what the error bubble says when an ask fails
export function askErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return NETWORK_ERROR_MESSAGE;
    if (error.status === 429) return error.message; // "Too many questions, try again later"
    if (error.status === 502) return "Couldn't answer the question. Try again.";
    if (error.status === 400 || error.status === 401) return error.message;
  }
  return "Something went wrong. Please try again.";
}

// Retry resends the same question; it can't help over the rate limit, with an invalid question or a signed-out session
export function canRetryAsk(error: unknown): boolean {
  return !(error instanceof ApiError && [400, 401, 403, 429].includes(error.status));
}
