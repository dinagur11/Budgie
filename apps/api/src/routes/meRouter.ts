import { Router } from "express";
import { getUserData, getActiveHouseholds, updateName, getMySpending } from "../services/meService.js";
import { validMonth, validName } from "../lib/validate.js";
import { HttpError } from "../middleware/errorHandler.js";
import { cancelPremium, resumePremium } from "../services/premiumService.js";

export const meRouter = Router();

//get user id, name, email and premium status
meRouter.get("/", async (req, res) => {
    const userId:number = req.user!.id;
    const user = await getUserData(userId);
    if (user === null)
        throw new HttpError(404, "user not found");
    return res.status(200).json(user);
})

//get user's active households
meRouter.get("/households", async (req, res) => {
    const userId:number = req.user!.id;
    const households = await getActiveHouseholds(userId);
    return res.status(200).json(households);
})

//what the user paid in a month, per currency, across their active households (?month=YYYY-MM, required)
meRouter.get("/spending", async (req, res) => {
    const userId:number = req.user!.id;
    const { first, last } = validMonth(req.query.month);
    const spending = await getMySpending(userId, first, last);
    return res.status(200).json(spending);
})

//change user name (email and password can be changed only via cognito)
meRouter.patch("/", async (req, res) => {
    const userId:number = req.user!.id;
    const { name } = req.body ?? {};
    const validatedName : string = validName(name);
    const updated = await updateName(userId, validatedName);
    return res.status(200).json(updated);
})

//cancel premium at the end of the paid month (the user stays premium until premiumEndsAt)
meRouter.post("/premium/cancel", async (req, res) => {
    return res.status(200).json(await cancelPremium(req.user!.id));
})

//undo a cancel before premiumEndsAt
meRouter.post("/premium/resume", async (req, res) => {
    return res.status(200).json(await resumePremium(req.user!.id));
})
