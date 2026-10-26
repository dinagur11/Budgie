import type { RequestHandler } from "express";
import { HttpError } from "./errorHandler.js";

// Use after requireAuth (and requireMember), on premium-only routes. requireAuth loads the user's row from the database
// on every request, so isPremium is the database's current value, never a claim from the token.
export const requirePremium: RequestHandler = (req, _res, next) => {
  if (!req.user?.isPremium) throw new HttpError(403, "Premium required");
  next();
};
