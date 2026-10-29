import type { RequestHandler } from "express";
import { HttpError } from "./errorHandler.js";
import { isPremiumActive } from "../lib/premium.js";

// Use after requireAuth (and requireMember), on premium-only routes. requireAuth loads the user's row from the database
// on every request, so isPremium is the database's current value, never a claim from the token.
// A canceled subscription past its premiumEndsAt is not premium, even before the daily cleanup resets the row.
export const requirePremium: RequestHandler = (req, _res, next) => {
  if (!req.user || !isPremiumActive(req.user)) throw new HttpError(403, "Premium required");
  next();
};
