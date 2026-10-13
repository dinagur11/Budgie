import type { RequestHandler } from "express";
import { prisma } from "../prisma.js";
import { HttpError } from "./errorHandler.js";
import type { HouseholdMember } from "../../generated/prisma/client.js";
import { validId } from "../lib/validate.js";

declare global {
  namespace Express {
    interface Request {
      membership?: HouseholdMember;
    }
  }
}

// Use after requireAuth, on routes with a :id param holding the household id.
export const requireMember: RequestHandler = async (req, _res, next) => {
  const householdIdRaw = req.params.id;
  const householdId = validId(householdIdRaw);

  const membership = await prisma.householdMember.findUnique({
    where: { userId_householdId: { userId: req.user!.id, householdId } },
  });

  // 404 (not 403) for non-members and former members, so household ids can't be probed
  if (!membership || membership.leftAt !== null) {
    throw new HttpError(404, "Household not found");
  }

  req.membership = membership;
  next();
};

// Use after requireMember, on owner-only routes.
export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.membership?.role !== "OWNER") {
    throw new HttpError(403, "Owner access required");
  }
  next();
};