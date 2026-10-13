import { prisma } from "../prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../middleware/errorHandler.js";
import { lockHousehold } from "./householdsService.js";

// custom categories per household, archived ones included
export const MAX_CATEGORIES_PER_HOUSEHOLD = 100;

export type CategoryUpdate = {
  name?: string;
  isArchived?: boolean;
}; 

//every category response has this shape: { id, name, isArchived, isBuiltIn }, never the household id
const categorySelect = { id: true, name: true, isArchived: true, householdId: true } as const;

function toCategory(c: { id: number; name: string; isArchived: boolean; householdId: number | null }) {
    return { id: c.id, name: c.name, isArchived: c.isArchived, isBuiltIn: c.householdId === null };
}

// same case folding as the unique index (lower()); a raw query so "%" and "_" are matched literally
async function builtInNameExists(name: string, db: Prisma.TransactionClient = prisma): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Category" WHERE "householdId" IS NULL AND lower("name") = lower(${name}) LIMIT 1`;
    return rows.length > 0;
}

export async function createCategory(name: string, householdId: number) {
    return prisma.$transaction(async (tx) => {
        // the household lock serializes creates, so the cap can't be exceeded
        if (!(await lockHousehold(householdId, tx)))
            throw new HttpError(404, "Household not found");
        if (await builtInNameExists(name, tx))
            throw new HttpError(409, "A category with this name already exists");
        const count = await tx.category.count({ where: { householdId } });
        if (count >= MAX_CATEGORIES_PER_HOUSEHOLD)
            throw new HttpError(409, "Category limit reached");

        try {
            const category = await tx.category.create({
                data: { name, householdId },
                select: categorySelect,
            });
            return toCategory(category);
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
                throw new HttpError(409, "A category with this name already exists");
            }
            throw err;
        }
    });
}

export async function deleteCategory(categoryId: number, householdId: number) {
    return prisma.$transaction(async (tx) => {
        // check ownership before locking, so a caller can't lock a built-in or another household's category
        const category = await tx.category.findUnique({
            where: {id: categoryId},
            select: { householdId: true },
        })
        if (category === null || (category.householdId !== null && category.householdId !== householdId)) 
            throw new HttpError(404, "Category not found");
        if (category.householdId === null)
            throw new HttpError(403, "Built-in categories can't be deleted");

        // lock, then count usage: a concurrent expense insert either committed first (counted here)
        // or waits for the lock and then fails on the foreign key
        if (!(await lockCategory(categoryId, tx)))
            throw new HttpError(404, "Category not found");
        const usage = await tx.category.findUnique({
            where: {id: categoryId},
            select: { _count: { select: { expenses: true, recurringRules: true } } },
        })
        if (usage!._count.expenses > 0 || usage!._count.recurringRules > 0)
            throw new HttpError(409, "Category is in use, archive it instead");
        await tx.category.delete({
            where: {id: categoryId},
        })
    })
}

export async function updateCategory(categoryId: number, householdId: number, dataToUpdate: CategoryUpdate) {
    const category = await prisma.category.findUnique({
        where: { id: categoryId },
        select: { householdId: true },
    });
    if (category === null || (category.householdId !== null && category.householdId !== householdId))
        throw new HttpError(404, "Category not found");
    if (category.householdId === null)
        throw new HttpError(403, "Built-in categories can't be changed");

    // a rename must not reuse a built-in's name (the unique index doesn't cover that)
    if (dataToUpdate.name !== undefined) {
        if (await builtInNameExists(dataToUpdate.name))
            throw new HttpError(409, "A category with this name already exists");
    }

    try {
        const updated = await prisma.category.update({
            where: { id: categoryId, householdId },
            data: dataToUpdate,
            select: categorySelect,
        });
        return toCategory(updated);
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === "P2002")
                throw new HttpError(409, "A category with this name already exists");
            if (err.code === "P2025")
                throw new HttpError(404, "Category not found");
        }
        throw err;
    }
}

export async function getAllCategories(householdId: number, includeArchived: boolean) {
    const categories = await prisma.category.findMany({
        where: {
        OR: [{ householdId: null }, { householdId }],
        ...(includeArchived ? {} : { isArchived: false }),
        },
        select: categorySelect,
    });
    // sorted here, not in SQL, so the order doesn't depend on the database collation
    categories.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id - b.id);
    return categories.map(toCategory);
}

export async function lockCategory(categoryId: number, tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Category" WHERE "id" = ${categoryId} FOR UPDATE`;
  return rows.length === 1;
}