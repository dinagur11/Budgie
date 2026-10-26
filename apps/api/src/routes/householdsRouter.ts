import { Router } from "express";
import { HttpError } from "../middleware/errorHandler.js";
import { requireMember, requireOwner } from "../middleware/household.js";
import { validName, validCurrency, validTimeZone, validId, optional, validBoolean, validAmount, validDate, validDescription, validFrequency, validMonth, validReceiptKey, validReceiptContentType, validReceiptSize, validMonthlyLimit, validQuestion, validHistory } from "../lib/validate.js";
import { createHousehold, updateHousehold, leaveHousehold, removeMember, deleteHousehold, getMembers, getHouseholdData} from "../services/householdsService.js"
import { createInvite, previewInvite, acceptInvite, listInvites, cancelInvite } from "../services/invitesService.js";
import { createCategory, deleteCategory, updateCategory, getAllCategories } from "../services/categoriesService.js"
import { createExpense, listExpenses, getExpense, updateExpense, deleteExpense } from "../services/expensesService.js";
import { decodeExpenseCursor } from "../lib/cursor.js";
import { createRule, listRules, getRule, updateRule, deleteRule } from "../services/recurringRulesService.js";
import { getCalendar } from "../services/calendarService.js";
import { getSummary } from "../services/summaryService.js";
import { analyzeReceipt, createReceiptUpload } from "../services/receiptsService.js";
import { askQuestion } from "../services/askService.js";
import { requirePremium } from "../middleware/premium.js";

export const householdsRouter = Router();

//create an household: name, currency and time-zone mandatory; monthlyLimit optional (missing or null means none)
householdsRouter.post("/", async (req, res) => {
    const userId = req.user!.id;
    const { name, defaultCurrency, timeZone, monthlyLimit } = req.body ?? {};
    const validatedName = validName(name);
    const validatedCurrency = validCurrency(defaultCurrency);
    const validatedZone = validTimeZone(timeZone);
    const validatedLimit = optional(monthlyLimit, validMonthlyLimit) ?? null;
    const household = await createHousehold(validatedName, validatedCurrency, validatedZone, validatedLimit, userId);
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

//update an household (name, currency, time-zone or monthlyLimit; monthlyLimit null removes the limit)
householdsRouter.patch("/:id", requireMember, requireOwner, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const { name, defaultCurrency, timeZone, monthlyLimit } = req.body ?? {};
    const data = {
        name: optional(name, validName),
        defaultCurrency: optional(defaultCurrency, validCurrency),
        timeZone: optional(timeZone, validTimeZone),
        monthlyLimit: optional(monthlyLimit, validMonthlyLimit),
    };

    if (Object.values(data).every((v) => v === undefined)) {
        throw new HttpError(400, "Nothing to update");
    }

    const household = await updateHousehold(householdId, data);
    return res.status(200).json({ ...household, role: "OWNER" });
})

//get all members (?includeFormer=true to include members who left or were removed)
householdsRouter.get("/:id/members", requireMember, async (req, res) => {
    const householdId:number = req.membership!.householdId;
    const raw = req.query.includeFormer;
    if (raw !== undefined && raw !== "true" && raw !== "false")
        throw new HttpError(400, "includeFormer must be true or false");
    const members = await getMembers(householdId, raw === "true");
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

//archive or unarchive category, or change name 
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

/* expenses */
//create an expense 
householdsRouter.post("/:id/expenses", requireMember, async (req, res) => {
    const userId = req.user!.id;
    const householdId = req.membership!.householdId;
    const { name, amount, currency, date, categoryId, paidById, description } = req.body ?? {};
    const validatedName = validName(name);
    const validatedAmount = validAmount(amount);
    const validatedCurrency = validCurrency(currency);
    const validatedDate = validDate(date);
    const validatedCategoryId = validId(categoryId);
    const validatedPaidById = validId(paidById);
    const validatedDescription = optional(description, validDescription);
    const expense = await createExpense(householdId, validatedName, validatedAmount, validatedCurrency, validatedDate, validatedCategoryId, validatedPaidById,
        validatedDescription, userId);
    return res.status(201).json(expense);
})

//a query parameter given at most once (a repeated one arrives as an array)
function singleQuery(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string")
        throw new HttpError(400, `${name} must not be repeated`);
    return value;
}

function validLimit(value: string): number {
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 100)
        throw new HttpError(400, "limit must be an integer from 1 to 100");
    return Number(value);
}

//list expenses, newest first (?from, ?to, ?categoryId, ?paidById, ?limit, ?cursor)
householdsRouter.get("/:id/expenses", requireMember, async (req, res) => {
    const householdId = req.membership!.householdId;
    const q = req.query;
    const from = optional(singleQuery(q.from, "from"), validDate);
    const to = optional(singleQuery(q.to, "to"), validDate);
    if (from !== undefined && to !== undefined && from > to)
        throw new HttpError(400, "from must not be after to");
    const categoryId = optional(singleQuery(q.categoryId, "categoryId"), validId);
    const paidById = optional(singleQuery(q.paidById, "paidById"), validId);
    const limit = optional(singleQuery(q.limit, "limit"), (v) => validLimit(v as string)) ?? 50;
    // the cursor must have been issued for these same filters
    const cursor = optional(singleQuery(q.cursor, "cursor"), (v) => decodeExpenseCursor(v as string, { householdId, from, to, categoryId, paidById }));
    const page = await listExpenses(householdId, { from, to, categoryId, paidById, limit, cursor });
    return res.status(200).json(page);
})

//get one expense
householdsRouter.get("/:id/expenses/:expenseId", requireMember, async (req, res) => {
    const householdId = req.membership!.householdId;
    const expenseId = validId(req.params.expenseId);
    const expense = await getExpense(expenseId, householdId);
    return res.status(200).json(expense);
})

//update an expense (payer, creator or owner)
householdsRouter.patch("/:id/expenses/:expenseId", requireMember, async (req, res) => {
    const { householdId, role } = req.membership!;
    const expenseId = validId(req.params.expenseId);
    const { name, amount, currency, date, categoryId, paidById, description } = req.body ?? {};
    const data = {
        name: optional(name, validName),
        amount: optional(amount, validAmount),
        currency: optional(currency, validCurrency),
        date: optional(date, validDate),
        categoryId: optional(categoryId, validId),
        paidById: optional(paidById, validId),
        // a string sets the description; null or an empty string clears it
        description: description === null ? null : optional(description, (v) => validDescription(v) ?? null),
    };
    if (Object.values(data).every((v) => v === undefined)) {
        throw new HttpError(400, "Nothing to update");
    }
    const expense = await updateExpense(expenseId, householdId, req.user!.id, role, data);
    return res.status(200).json(expense);
})

//delete an expense (payer, creator or owner)
householdsRouter.delete("/:id/expenses/:expenseId", requireMember, async (req, res) => {
    const { householdId, role } = req.membership!;
    const expenseId = validId(req.params.expenseId);
    await deleteExpense(expenseId, householdId, req.user!.id, role);
    return res.status(204).end();
})

/* recurring rules */
//create recurring rule. only end-date optional
householdsRouter.post("/:id/rules", requireMember, async (req, res) => {
    const createdById = req.user!.id;
    const householdId = req.membership!.householdId;
    const { name, startDate, endDate, amount, currency, paidById, categoryId, frequency } = req.body ?? {};
    const validatedName = validName(name);
    const validatedStart = validDate(startDate);
    const validatedEnd = optional(endDate, validDate);
    const validatedAmount = validAmount(amount);
    const validatedCurrency = validCurrency(currency);
    const validatedPaidById = validId(paidById);
    const validatedCategoryId = validId(categoryId);
    const validatedFreq = validFrequency(frequency);

    if (validatedEnd && validatedEnd < validatedStart)
        throw new HttpError(400, "End date must be on or after start date");

    const rule = await createRule(createdById, householdId, validatedName, validatedStart, validatedEnd, validatedAmount, validatedCurrency, 
        validatedPaidById, validatedCategoryId, validatedFreq,);
    return res.status(201).json(rule);
})

//list rules, newest first (?activeOnly=true for rules that still have occurrences)
householdsRouter.get("/:id/rules", requireMember, async (req, res) => {
    const householdId = req.membership!.householdId;
    const raw = req.query.activeOnly;
    if (raw !== undefined && raw !== "true" && raw !== "false")
        throw new HttpError(400, "activeOnly must be true or false");
    const rules = await listRules(householdId, raw === "true");
    return res.status(200).json(rules);
})

//get one rule
householdsRouter.get("/:id/rules/:ruleId", requireMember, async (req, res) => {
    const householdId = req.membership!.householdId;
    const ruleId = validId(req.params.ruleId);
    const rule = await getRule(ruleId, householdId);
    return res.status(200).json(rule);
})

//update a rule (payer, creator or owner; changing the payer: creator or owner)
householdsRouter.patch("/:id/rules/:ruleId", requireMember, async (req, res) => {
    const { householdId, role } = req.membership!;
    const ruleId = validId(req.params.ruleId);
    const { name, amount, currency, frequency, startDate, endDate, paidById, categoryId } = req.body ?? {};
    const data = {
        name: optional(name, validName),
        amount: optional(amount, validAmount),
        currency: optional(currency, validCurrency),
        frequency: optional(frequency, validFrequency),
        startDate: optional(startDate, validDate),
        // null clears the end date
        endDate: endDate === null ? null : optional(endDate, validDate),
        paidById: optional(paidById, validId),
        categoryId: optional(categoryId, validId),
    };
    if (Object.values(data).every((v) => v === undefined)) {
        throw new HttpError(400, "Nothing to update");
    }
    const rule = await updateRule(ruleId, householdId, req.user!.id, role, data);
    return res.status(200).json(rule);
})

//delete a rule (payer, creator or owner); ?deleteExpenses=true also deletes its expenses
householdsRouter.delete("/:id/rules/:ruleId", requireMember, async (req, res) => {
    const { householdId, role } = req.membership!;
    const ruleId = validId(req.params.ruleId);
    const raw = req.query.deleteExpenses;
    if (raw !== undefined && raw !== "true" && raw !== "false")
        throw new HttpError(400, "deleteExpenses must be true or false");
    await deleteRule(ruleId, householdId, req.user!.id, role, raw === "true");
    return res.status(204).end();
})

/* calendar */
//a month's real expenses plus the projected future occurrences of active rules (?month=YYYY-MM, required)
householdsRouter.get("/:id/calendar", requireMember, async (req, res) => {
    const householdId = req.membership!.householdId;
    // a repeated parameter arrives as an array and is rejected by validMonth
    const { first, last } = validMonth(req.query.month);
    const calendar = await getCalendar(householdId, first, last);
    return res.status(200).json(calendar);
})

/* summary */
//a month's totals per currency: spent (real expenses) and projected (the calendar's projections) (?month=YYYY-MM, required)
householdsRouter.get("/:id/summary", requireMember, async (req, res) => {
    const householdId = req.membership!.householdId;
    // a repeated parameter arrives as an array and is rejected by validMonth
    const { first, last } = validMonth(req.query.month);
    const summary = await getSummary(householdId, first, last);
    return res.status(200).json(summary);
})

/* receipts */
//a presigned URL to upload one receipt image (JPEG, up to 5,000,000 bytes) straight to S3
householdsRouter.post("/:id/receipts", requireMember, async (req, res) => {
    const { contentType, byteSize } = req.body ?? { };
    const householdId = req.membership!.householdId;
    const upload = await createReceiptUpload(householdId, req.user!.id, {
        contentType: validReceiptContentType(contentType),
        byteSize: validReceiptSize(byteSize),
    });
    return res.status(200).json(upload);
})

householdsRouter.post("/:id/receipts/analyze", requireMember, async (req, res) => {
    const { key } = req.body ?? { };
    const householdId = req.membership!.householdId;
    const validatedKey = validReceiptKey(key, householdId);
    const suggestion = await analyzeReceipt(householdId, req.user!.id, validatedKey);
    return res.status(200).json(suggestion);
})

/* ask ai */
//a question about the household's spending in plain English, answered from its data (premium only)
householdsRouter.post("/:id/ask", requireMember, requirePremium, async (req, res) => {
    const { question, history } = req.body ?? { };
    const householdId = req.membership!.householdId;
    const validatedQuestion = validQuestion(question);
    const validatedHistory = optional(history, validHistory) ?? [];
    const answer = await askQuestion(householdId, req.user!.id, validatedQuestion, validatedHistory);
    return res.status(200).json({ answer });
})
