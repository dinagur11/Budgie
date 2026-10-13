import type { RequestHandler } from "express";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "../config.js";
import { prisma } from "../prisma.js";
import { HttpError } from "./errorHandler.js";
import type { User } from "../../generated/prisma/client.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const verifier = CognitoJwtVerifier.create({
  userPoolId: config.cognitoUserPoolId,
  tokenUse: "id", // we accept ID tokens, since they carry email and name
  clientId: config.cognitoClientId,
});

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token");
  }

  let payload;
  try {
    payload = await verifier.verify(header.slice("Bearer ".length));
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }

  const email = payload.email as string | undefined;
  if (!email) throw new HttpError(401, "Token has no email claim");
  const name = (payload.name as string | undefined) ?? email.split("@")[0];

  // find-or-create; upsert is safe if two first requests arrive at once
  req.user = await prisma.user.upsert({
    where: { cognitoId: payload.sub },
    update: {},
    create: { cognitoId: payload.sub, email, name },
  });

  next();
};