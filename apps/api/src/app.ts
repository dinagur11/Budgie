import express from "express";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { householdsRouter } from "./routes/householdsRouter.js";
import { meRouter } from "./routes/meRouter.js";

export const app = express();

app.use(express.json());

app.use("/households", requireAuth, householdsRouter);
app.use("/me", requireAuth, meRouter);

app.use(errorHandler);