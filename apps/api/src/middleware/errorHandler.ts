import type { ErrorRequestHandler } from "express";
import { Prisma } from "../../generated/prisma/client.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Unique constraint violation: two requests raced to create the same row
  // (e.g. the same user accepting two invites to one household at once).
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return res.status(409).json({ error: "This record already exists" });
  }
  // Client errors raised by Express middleware (e.g. body-parser: malformed JSON, body too large).
  // Only errors marked expose (as Express does); the message comes from the status because err.message can quote the input.
  const status = err?.status ?? err?.statusCode;
  if (typeof status === "number" && status >= 400 && status <= 499 && err.expose === true) {
    const messages: Record<number, string> = {
      400: "Invalid request body",
      413: "Request body too large",
      415: "Unsupported content type",
    };
    return res.status(status).json({ error: messages[status] ?? "Bad request" });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};