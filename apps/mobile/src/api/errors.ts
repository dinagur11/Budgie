// an API error with the server's status and message (the backend answers errors as { error: "..." })
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// status 0 means the request never got an answer (offline, server down, wrong EXPO_PUBLIC_API_URL)
export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";

export async function toApiError(response: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    // not JSON: keep the generic message
  }
  return new ApiError(response.status, message);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}
