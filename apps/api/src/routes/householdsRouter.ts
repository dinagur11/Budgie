import { Router } from "express";
import { HttpError } from "../middleware/errorHandler.js";
import { requireMember, requireOwner } from "../middleware/household.js";
import { validName, validCurrency, validTimeZone, validId, optional } from "../lib/validate.js";
import { createHousehold, updateHousehold, leaveHousehold, removeMember, deleteHousehold, getMembers, getHouseholdData} from "../services/householdsService.js"

export const householdsRouter = Router();

//create an household
householdsRouter.post("/", async (req, res) => {
    const userId = req.user!.id;
    const { name, defaultCurrency, timeZone } = req.body ?? {};
    const validatedName = validName(name);
    const validatedCurrency = validCurrency(defaultCurrency);
    const validatedZone = validTimeZone(timeZone);
    const household = await createHousehold(validatedName, validatedCurrency, validatedZone, userId);
    return res.status(201).json({ ...household, role: "OWNER" });
})

//get household data
householdsRouter.get("/:id", requireMember, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const household = await getHouseholdData(householdId);
    if (household === null)
        throw new HttpError(404, "household not found");
    return res.status(200).json({ ...household, role: req.membership!.role });
})

//update an household (name, currency or time-zone)
householdsRouter.patch("/:id", requireMember, requireOwner, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const { name, defaultCurrency, timeZone } = req.body ?? {};
    const data = {
        name: optional(name, validName),
        defaultCurrency: optional(defaultCurrency, validCurrency),
        timeZone: optional(timeZone, validTimeZone),
    };

    if (Object.values(data).every((v) => v === undefined)) {
        throw new HttpError(400, "Nothing to update");
    }

    const household = await updateHousehold(householdId, data);
    return res.status(200).json({ ...household, role: "OWNER" });
})

//get all members
householdsRouter.get("/:id/members", requireMember, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const members = await getMembers(householdId);
    return res.status(200).json(members);
})

//leave household (must be before remove because of express route matching)
householdsRouter.delete("/:id/members/me", requireMember, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const userId:number = req.membership!.userId;
    await leaveHousehold(householdId, userId);
    return res.status(204).end();
})

//remove member
householdsRouter.delete("/:id/members/:userId", requireMember, requireOwner, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const userIdStr = req.params.userId;
    const userId:number = validId(userIdStr);
    const currId:number = req.membership!.userId;
    if (userId === currId)
        throw new HttpError(400, "Use the leave endpoint to leave a household.")
    await removeMember(householdId, userId);
    return res.status(204).end();
})

//delete household
householdsRouter.delete("/:id", requireMember, requireOwner, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    await deleteHousehold(householdId);
    return res.status(204).end();
})