import { fetchAuthSession } from "aws-amplify/auth";
import { config } from "../config";
import { ApiError, NETWORK_ERROR_MESSAGE, toApiError } from "./errors";
import { FIXTURES, fixtureResponse, fixtureScenario } from "../fixtures/fixtures";

// called once on a 401: the session provider signs out, which sends the user to the login screen
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

type Options = { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown };

// The one way the app talks to the API. Every request asks Amplify for the current session first, so token
// refresh and expiry are handled here; it sends the ID token (the backend verifies ID tokens). Tokens are never logged.
export async function apiFetch<T>(path: string, { method = "GET", body }: Options = {}): Promise<T> {
  if (FIXTURES) {
    // the one write fixtures answer: Ask AI, for screenshots of the chat
    if (method !== "GET" && !/^\/households\/\d+\/ask$/.test(path)) throw new ApiError(400, "Not available in fixture mode");
    return fixtureResponse(path, fixtureScenario()) as T;
  }
  let idToken: string | undefined;
  try {
    idToken = (await fetchAuthSession()).tokens?.idToken?.toString();
  } catch {
    idToken = undefined;
  }
  if (!idToken) {
    onUnauthorized?.();
    throw new ApiError(401, "Your session has ended. Please log in again.");
  }

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${idToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE);
  }

  if (response.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "Your session has ended. Please log in again.");
  }
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
