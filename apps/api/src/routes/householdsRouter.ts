import { Router } from "express";
import { HttpError } from "../middleware/errorHandler.js";
import { requireMember, requireOwner } from "../middleware/household.js";
import { validName, validCurrency, validTimeZone, validId, optional, validBoolean } from "../lib/validate.js";
import { createHousehold, updateHousehold, leaveHousehold, removeMember, deleteHousehold, getMembers, getHouseholdData} from "../services/householdsService.js"
import { createInvite, previewInvite, acceptInvite, listInvites, cancelInvite } from "../services/invitesService.js";
import { createCategory, deleteCategory, updateCategory, getAllCategories } from "../services/categoriesService.js"

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

/* invites */
//preview an invite before joining (token in the body, never in the URL; registered before the /:id routes)
householdsRouter.post("/join/preview", async (req, res) => {
    const token = validToken(req.body?.token);
    const preview = await previewInvite(token);
    return res.status(200).json(preview);
})

//accept an invite and join the household as MEMBER
householdsRouter.post("/join", async (req, res) => {
    const userId = req.user!.id;
    const token = validToken(req.body?.token);
    const household = await acceptInvite(token, userId);
    return res.status(200).json(household);
})

//create an invite link (the raw token is returned once; the app builds the link)
householdsRouter.post("/:id/invites", requireMember, requireOwner, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const invite = await createInvite(householdId);
    return res.status(201).json(invite);
})

//list active invites (never anything token-related)
householdsRouter.get("/:id/invites", requireMember, requireOwner, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const invites = await listInvites(householdId);
    return res.status(200).json(invites);
})

//cancel an invite
householdsRouter.delete("/:id/invites/:inviteId", requireMember, requireOwner, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const inviteId:number = validId(req.params.inviteId);
    await cancelInvite(householdId, inviteId);
    return res.status(204).end();
})

//invite tokens are 43 base64url characters; anything that isn't a short non-empty string is rejected
function validToken(value: unknown): string {
    if (typeof value !== "string" || value.length < 1 || value.length > 128)
        throw new HttpError(400, "Invalid token");
    return value;
}

/* categories */
//create category
householdsRouter.post("/:id/categories", requireMember, async (req, res) => {
    const { name } = req.body ?? {};
    const validatedName = validName(name);
    const householdId:number = req.membership!.householdId;
    const category = await createCategory(validatedName, householdId);
    return res.status(201).json(category);
})

//delete category
householdsRouter.delete("/:id/categories/:categoryId", requireMember, requireOwner, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const categoryId = req.params.categoryId;
    const validatedId = validId(categoryId);
    await deleteCategory(validatedId, householdId);
    return res.status(204).end();  
})

//archive or unarchive category
householdsRouter.patch("/:id/categories/:categoryId", requireMember, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const categoryId = req.params.categoryId;
    const validatedId = validId(categoryId);
    const { name, isArchived } = req.body ?? {};
    const data = {
        name: optional(name, validName),
        isArchived : optional(isArchived, (v) => validBoolean(v, "isArchived"))
    };
    if (Object.values(data).every((v) => v === undefined)) {
        throw new HttpError(400, "Nothing to update");
    }
    const category = await updateCategory(validatedId, householdId, data);
    return res.status(200).json(category);
})

//get all categories (?includeArchived=true to include archived ones)
householdsRouter.get("/:id/categories", requireMember, async (req, res) => {
    const householdId: number = req.membership!.householdId;
    const raw = req.query.includeArchived;
    if (raw !== undefined && raw !== "true" && raw !== "false")
        throw new HttpError(400, "includeArchived must be true or false");
    const includeArchived = raw === "true";
    const categories = await getAllCategories(householdId, includeArchived);
    return res.status(200).json(categories);
})