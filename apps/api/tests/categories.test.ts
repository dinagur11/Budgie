import { describe, it, expect, beforeAll } from "vitest";
import { prisma, as, anon, createUser, createHousehold, addMember, MAX_ID } from "./helpers.js";

const DUPLICATE = "A category with this name already exists";
const INVALID_IDS = ["abc", "0", "-1", "1.5", "007", "2147483648"];
const ITEM_KEYS = ["id", "isArchived", "isBuiltIn", "name"];

let builtIns: { id: number; name: string }[] = [];
let other: { id: number; name: string };

beforeAll(async () => {
  builtIns = await prisma.category.findMany({ where: { householdId: null }, select: { id: true, name: true } });
  const found = builtIns.find((c) => c.name === "Other");
  if (!found) throw new Error('Built-in categories are missing in the test database. Run "npx prisma db seed" against expenses_test.');
  other = found;
});

async function setup() {
  const owner = await createUser("Owner");
  const member = await createUser("Member");
  const h = await createHousehold("Home", owner);
  await addMember(h.id, member.id);
  return { owner, member, h };
}

const base = (householdId: number) => `/households/${householdId}/categories`;

async function custom(householdId: number, name: string, isArchived = false) {
  return prisma.category.create({ data: { householdId, name, isArchived } });
}

async function addExpense(householdId: number, userId: number, categoryId: number) {
  return prisma.expense.create({
    data: { name: "Vet", amount: 100, currency: "USD", date: new Date("2026-03-01"), categoryId, paidById: userId, createdById: userId, householdId },
  });
}

async function addRule(householdId: number, userId: number, categoryId: number) {
  return prisma.recurringRule.create({
    data: {
      name: "Gym", amount: 5000, currency: "USD", frequency: "MONTHLY", startDate: new Date("2026-01-01"),
      householdId, paidById: userId, createdById: userId, categoryId,
    },
  });
}

describe("POST /households/:id/categories", () => {
  it("a member creates a category; the name is trimmed; no householdId in the response", async () => {
    const { member, h } = await setup();
    const res = await as(member).post(base(h.id)).send({ name: "  Pets  " });
    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(Number));
    expect(res.body.name).toBe("Pets");
    expect(res.body).not.toHaveProperty("householdId");
    for (const key of Object.keys(res.body)) expect(ITEM_KEYS).toContain(key);

    const row = await prisma.category.findUnique({ where: { id: res.body.id } });
    expect(row).toMatchObject({ householdId: h.id, name: "Pets", isArchived: false });
  });

  it("create returns the shared category shape { id, name, isArchived, isBuiltIn }", async () => {
    const { owner, h } = await setup();
    const res = await as(owner).post(base(h.id)).send({ name: "Kids" });
    expect(res.status).toBe(201);
    expect(res.body).toStrictEqual({ id: expect.any(Number), name: "Kids", isArchived: false, isBuiltIn: false });
  });

  it("create, update and list return the same shape for the same category", async () => {
    const { owner, h } = await setup();
    const created = (await as(owner).post(base(h.id)).send({ name: "Kids" })).body;
    const updated = (await as(owner).patch(`${base(h.id)}/${created.id}`).send({ name: "Kids" })).body;
    const listed = (await as(owner).get(base(h.id))).body.find((c: any) => c.id === created.id);
    expect(updated).toStrictEqual(created);
    expect(listed).toStrictEqual(created);
  });

  it("accepts a 100-character name", async () => {
    const { owner, h } = await setup();
    expect((await as(owner).post(base(h.id)).send({ name: "a".repeat(100) })).status).toBe(201);
  });

  const badNames: [string, unknown][] = [
    ["missing name", {}],
    ["empty name", { name: "" }],
    ["whitespace name", { name: "   " }],
    ["101-char name", { name: "a".repeat(101) }],
    ["numeric name", { name: 5 }],
    ["null name", { name: null }],
    ["array name", { name: ["x"] }],
  ];
  for (const [label, body] of badNames) {
    it(`returns 400 for ${label}`, async () => {
      const { owner, h } = await setup();
      const res = await as(owner).post(base(h.id)).send(body as object);
      expect(res.status).toBe(400);
      expect(await prisma.category.count({ where: { householdId: h.id } })).toBe(0);
    });
  }

  it("returns 400 with no body", async () => {
    const { owner, h } = await setup();
    expect((await as(owner).post(base(h.id))).status).toBe(400);
  });

  it("rejects a duplicate name case-insensitively (409)", async () => {
    const { owner, member, h } = await setup();
    expect((await as(owner).post(base(h.id)).send({ name: "Pets" })).status).toBe(201);
    for (const name of ["Pets", "pets", "PETS", "  pEtS "]) {
      const res = await as(member).post(base(h.id)).send({ name });
      expect(res.status).toBe(409);
      expect(res.body).toStrictEqual({ error: DUPLICATE });
    }
    expect(await prisma.category.count({ where: { householdId: h.id } })).toBe(1);
  });

  it("rejects a name that clashes with a built-in (409), e.g. 'other' vs 'Other'", async () => {
    const { owner, h } = await setup();
    for (const name of ["other", "Other", "GROCERIES", "dining out"]) {
      const res = await as(owner).post(base(h.id)).send({ name });
      expect(res.status).toBe(409);
      expect(res.body).toStrictEqual({ error: DUPLICATE });
    }
  });

  it("an archived name stays reserved (409)", async () => {
    const { owner, h } = await setup();
    await custom(h.id, "Old", true);
    const res = await as(owner).post(base(h.id)).send({ name: "old" });
    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: DUPLICATE });
  });

  // the built-in check must match "%" and "_" literally (it used to be an unescaped ILIKE)
  for (const name of ["%", "Oth_r", "_ther", "Rent%", "o%"]) {
    it(`a name with LIKE wildcards (${JSON.stringify(name)}) that is not a built-in is accepted (201)`, async () => {
      const { owner, h } = await setup();
      const res = await as(owner).post(base(h.id)).send({ name });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe(name);
    });
  }

  it("the same name in two different households is allowed", async () => {
    const { owner, h } = await setup();
    const otherOwner = await createUser();
    const h2 = await createHousehold("Other", otherOwner);
    expect((await as(owner).post(base(h.id)).send({ name: "Pets" })).status).toBe(201);
    expect((await as(otherOwner).post(base(h2.id)).send({ name: "pets" })).status).toBe(201);
  });

  it("two simultaneous creates of the same name: one 201, one 409, never 500", async () => {
    for (let round = 0; round < 5; round++) {
      const { owner, member, h } = await setup();
      const results = await Promise.all([
        as(owner).post(base(h.id)).send({ name: "Race" }),
        as(member).post(base(h.id)).send({ name: "race" }),
      ]);
      expect(results.map((r) => r.status).sort()).toStrictEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body).toStrictEqual({ error: DUPLICATE });
      expect(await prisma.category.count({ where: { householdId: h.id } })).toBe(1);
    }
  });
});

describe("GET /households/:id/categories", () => {
  it("returns built-ins plus the household's own, never another household's; archived excluded by default", async () => {
    const { member, h } = await setup();
    const pets = await custom(h.id, "Pets");
    await custom(h.id, "Archived", true);
    const otherOwner = await createUser();
    const h2 = await createHousehold("Other", otherOwner);
    await custom(h2.id, "Secret");

    const res = await as(member).get(base(h.id));
    expect(res.status).toBe(200);
    const names = res.body.map((c: any) => c.name);
    expect(names).toContain("Pets");
    expect(names).not.toContain("Archived");
    expect(names).not.toContain("Secret");
    expect(res.body).toHaveLength(builtIns.length + 1);
    for (const b of builtIns) {
      expect(res.body).toContainEqual({ id: b.id, name: b.name, isArchived: false, isBuiltIn: true });
    }
    expect(res.body).toContainEqual({ id: pets.id, name: "Pets", isArchived: false, isBuiltIn: false });
    for (const item of res.body) expect(Object.keys(item).sort()).toStrictEqual(ITEM_KEYS);
    expect(JSON.stringify(res.body)).not.toContain("householdId");
  });

  it("includeArchived=true includes archived categories; includeArchived=false excludes them", async () => {
    const { owner, h } = await setup();
    const arch = await custom(h.id, "Archived", true);
    const yes = await as(owner).get(`${base(h.id)}?includeArchived=true`);
    expect(yes.status).toBe(200);
    expect(yes.body).toContainEqual({ id: arch.id, name: "Archived", isArchived: true, isBuiltIn: false });
    const no = await as(owner).get(`${base(h.id)}?includeArchived=false`);
    expect(no.status).toBe(200);
    expect(no.body.map((c: any) => c.id)).not.toContain(arch.id);
  });

  for (const qs of ["includeArchived=TRUE", "includeArchived=1", "includeArchived=", "includeArchived=yes",
    "includeArchived=true&includeArchived=true", "includeArchived=true&includeArchived=false"]) {
    it(`returns 400 for ?${qs}`, async () => {
      const { owner, h } = await setup();
      const res = await as(owner).get(`${base(h.id)}?${qs}`);
      expect(res.status).toBe(400);
    });
  }

  it("includeArchived[a]=true is a different parameter name (Express 5 simple query parser) and is ignored", async () => {
    const { owner, h } = await setup();
    const arch = await custom(h.id, "Archived", true);
    const res = await as(owner).get(`${base(h.id)}?includeArchived[a]=true`);
    expect(res.status).toBe(200);
    expect(res.body.map((c: any) => c.id)).not.toContain(arch.id);
  });

  it("is ordered by name", async () => {
    const { owner, h } = await setup();
    for (const n of ["Zoo", "Apples", "Kids", "Mortgage"]) await custom(h.id, n);
    const res = await as(owner).get(base(h.id));
    const names: string[] = res.body.map((c: any) => c.name);
    expect(names).toStrictEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(names.indexOf("Apples")).toBe(0);
    expect(names[names.length - 1]).toBe("Zoo");
  });
});

describe("PATCH /households/:id/categories/:categoryId", () => {
  it("a member renames a category (trimmed); response is { id, name, isArchived, isBuiltIn }", async () => {
    const { member, h } = await setup();
    const pets = await custom(h.id, "Pets");
    const res = await as(member).patch(`${base(h.id)}/${pets.id}`).send({ name: "  Animals " });
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: pets.id, name: "Animals", isArchived: false, isBuiltIn: false });
    expect((await prisma.category.findUnique({ where: { id: pets.id } }))?.name).toBe("Animals");
  });

  it("archive and unarchive", async () => {
    const { member, h } = await setup();
    const pets = await custom(h.id, "Pets");
    let res = await as(member).patch(`${base(h.id)}/${pets.id}`).send({ isArchived: true });
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: pets.id, name: "Pets", isArchived: true, isBuiltIn: false });
    expect((await as(member).get(base(h.id))).body.map((c: any) => c.id)).not.toContain(pets.id);

    res = await as(member).patch(`${base(h.id)}/${pets.id}`).send({ isArchived: false });
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: pets.id, name: "Pets", isArchived: false, isBuiltIn: false });
    expect((await as(member).get(base(h.id))).body.map((c: any) => c.id)).toContain(pets.id);
  });

  it("rename and archive together", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    const res = await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ name: "Animals", isArchived: true });
    expect(res.body).toStrictEqual({ id: pets.id, name: "Animals", isArchived: true, isBuiltIn: false });
  });

  it("changing only the case of its own name is allowed", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "pets");
    const res = await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ name: "Pets" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Pets");
  });

  it("archiving a category that has expenses works and the expenses keep it", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    const e = await addExpense(h.id, owner.id, pets.id);
    const res = await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ isArchived: true });
    expect(res.status).toBe(200);
    expect((await prisma.expense.findUnique({ where: { id: e.id } }))?.categoryId).toBe(pets.id);
  });

  it("empty body or only unknown fields returns 400 'Nothing to update'", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    for (const body of [{}, { foo: 1 }, { householdId: 999 }]) {
      const res = await as(owner).patch(`${base(h.id)}/${pets.id}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Nothing to update" });
    }
    expect((await as(owner).patch(`${base(h.id)}/${pets.id}`)).status).toBe(400);
    expect((await prisma.category.findUnique({ where: { id: pets.id } }))?.householdId).toBe(h.id);
  });

  const bad: [string, object][] = [
    ['isArchived "false"', { isArchived: "false" }],
    ["isArchived 0", { isArchived: 0 }],
    ["isArchived null", { isArchived: null }],
    ["empty name", { name: "" }],
    ["101-char name", { name: "a".repeat(101) }],
    ["numeric name", { name: 3 }],
    ["null name", { name: null }],
    ["valid name with bad isArchived", { name: "Fine", isArchived: "yes" }],
  ];
  for (const [label, body] of bad) {
    it(`returns 400 for ${label} and changes nothing`, async () => {
      const { owner, h } = await setup();
      const pets = await custom(h.id, "Pets");
      const res = await as(owner).patch(`${base(h.id)}/${pets.id}`).send(body);
      expect(res.status).toBe(400);
      expect(await prisma.category.findUnique({ where: { id: pets.id } })).toMatchObject({ name: "Pets", isArchived: false });
    });
  }

  it("renaming to an existing name returns 409 (household, archived and built-in names)", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    await custom(h.id, "Food");
    await custom(h.id, "Old", true);
    for (const name of ["food", "OLD", "other"]) {
      const res = await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ name });
      expect(res.status).toBe(409);
      expect(res.body).toStrictEqual({ error: DUPLICATE });
    }
    expect((await prisma.category.findUnique({ where: { id: pets.id } }))?.name).toBe("Pets");
  });

  it("renaming to a name with LIKE wildcards that is not a built-in is allowed", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    const res = await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ name: "Oth_r" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Oth_r");
  });

  it("two simultaneous renames to the same name: one 200, one 409, never 500", async () => {
    for (let round = 0; round < 5; round++) {
      const { owner, member, h } = await setup();
      const a = await custom(h.id, "A");
      const b = await custom(h.id, "B");
      const results = await Promise.all([
        as(owner).patch(`${base(h.id)}/${a.id}`).send({ name: "Same" }),
        as(member).patch(`${base(h.id)}/${b.id}`).send({ name: "same" }),
      ]);
      expect(results.map((r) => r.status).sort()).toStrictEqual([200, 409]);
      expect(await prisma.category.count({ where: { householdId: h.id, name: { equals: "same", mode: "insensitive" } } })).toBe(1);
    }
  });

  it("a rename racing a delete of the same category: 200 or 404, never 500", async () => {
    for (let round = 0; round < 10; round++) {
      const { owner, h } = await setup();
      const pets = await custom(h.id, "Pets");
      const [patch, del] = await Promise.all([
        as(owner).patch(`${base(h.id)}/${pets.id}`).send({ name: `Animals${round}` }),
        as(owner).delete(`${base(h.id)}/${pets.id}`),
      ]);
      expect(del.status).toBe(204);
      expect([200, 404]).toContain(patch.status);
      expect(await prisma.category.count({ where: { id: pets.id } })).toBe(0);
    }
  });

  it("renaming to a name used by another household is allowed", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    const h2 = await createHousehold("Other", await createUser());
    await custom(h2.id, "Animals");
    expect((await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ name: "Animals" })).status).toBe(200);
  });

  it("built-ins can't be renamed or archived (403)", async () => {
    const { owner, member, h } = await setup();
    for (const u of [owner, member]) {
      expect((await as(u).patch(`${base(h.id)}/${other.id}`).send({ name: "Misc" })).status).toBe(403);
      expect((await as(u).patch(`${base(h.id)}/${other.id}`).send({ isArchived: true })).status).toBe(403);
    }
    expect(await prisma.category.findUnique({ where: { id: other.id } })).toMatchObject({ name: "Other", isArchived: false, householdId: null });
  });

  it("another household's category or a missing id: 404 with the same body, nothing changes", async () => {
    const { owner, h } = await setup();
    const h2 = await createHousehold("Other", await createUser());
    const secret = await custom(h2.id, "Secret");
    const foreign = await as(owner).patch(`${base(h.id)}/${secret.id}`).send({ name: "Hacked" });
    const missing = await as(owner).patch(`${base(h.id)}/2147483647`).send({ name: "Hacked" });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toStrictEqual(missing.body);
    expect((await prisma.category.findUnique({ where: { id: secret.id } }))?.name).toBe("Secret");
  });
});

describe("DELETE /households/:id/categories/:categoryId", () => {
  it("owner deletes an unused custom category (204); other categories are untouched", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    const keep = await custom(h.id, "Keep");
    const h2 = await createHousehold("Other", await createUser());
    const foreignKeep = await custom(h2.id, "Pets");
    const res = await as(owner).delete(`${base(h.id)}/${pets.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(await prisma.category.findUnique({ where: { id: pets.id } })).toBeNull();
    expect(await prisma.category.count({ where: { id: { in: [keep.id, foreignKeep.id] } } })).toBe(2);
    expect(await prisma.category.count({ where: { householdId: null } })).toBe(builtIns.length);
  });

  it("deleting an archived unused category works", async () => {
    const { owner, h } = await setup();
    const old = await custom(h.id, "Old", true);
    expect((await as(owner).delete(`${base(h.id)}/${old.id}`)).status).toBe(204);
  });

  it("a category used by an expense: 409, nothing deleted", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    await addExpense(h.id, owner.id, pets.id);
    const res = await as(owner).delete(`${base(h.id)}/${pets.id}`);
    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: expect.any(String) });
    expect(await prisma.category.count({ where: { id: pets.id } })).toBe(1);
  });

  it("a category used only by a recurring rule: 409", async () => {
    const { owner, h } = await setup();
    const gym = await custom(h.id, "Gym");
    await addRule(h.id, owner.id, gym.id);
    const res = await as(owner).delete(`${base(h.id)}/${gym.id}`);
    expect(res.status).toBe(409);
    expect(await prisma.category.count({ where: { id: gym.id } })).toBe(1);
  });

  it("an archived category that is still in use: 409", async () => {
    const { owner, h } = await setup();
    const old = await custom(h.id, "Old", true);
    await addExpense(h.id, owner.id, old.id);
    const oldRule = await custom(h.id, "OldRule", true);
    await addRule(h.id, owner.id, oldRule.id);
    expect((await as(owner).delete(`${base(h.id)}/${old.id}`)).status).toBe(409);
    expect((await as(owner).delete(`${base(h.id)}/${oldRule.id}`)).status).toBe(409);
    expect(await prisma.category.count({ where: { id: { in: [old.id, oldRule.id] } } })).toBe(2);
  });

  it("built-ins can't be deleted (403)", async () => {
    const { owner, h } = await setup();
    const res = await as(owner).delete(`${base(h.id)}/${other.id}`);
    expect(res.status).toBe(403);
    expect(await prisma.category.count({ where: { id: other.id } })).toBe(1);
  });

  it("a MEMBER gets 403", async () => {
    const { member, h } = await setup();
    const pets = await custom(h.id, "Pets");
    expect((await as(member).delete(`${base(h.id)}/${pets.id}`)).status).toBe(403);
    expect(await prisma.category.count({ where: { id: pets.id } })).toBe(1);
  });

  it("another household's category or a missing id: 404 with the same body, nothing deleted", async () => {
    const { owner, h } = await setup();
    const h2 = await createHousehold("Other", await createUser());
    const secret = await custom(h2.id, "Secret");
    const foreign = await as(owner).delete(`${base(h.id)}/${secret.id}`);
    const missing = await as(owner).delete(`${base(h.id)}/2147483647`);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toStrictEqual(missing.body);
    expect(await prisma.category.count({ where: { id: secret.id } })).toBe(1);
  });

  it("two simultaneous deletes of the same category: one 204, one 404, never 500", async () => {
    for (let round = 0; round < 5; round++) {
      const { owner, h } = await setup();
      const pets = await custom(h.id, `Pets${round}`);
      const results = await Promise.all([
        as(owner).delete(`${base(h.id)}/${pets.id}`),
        as(owner).delete(`${base(h.id)}/${pets.id}`),
      ]);
      expect(results.map((r) => r.status).sort()).toStrictEqual([204, 404]);
    }
  });

  it("deleting twice: the second returns 404", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    expect((await as(owner).delete(`${base(h.id)}/${pets.id}`)).status).toBe(204);
    expect((await as(owner).delete(`${base(h.id)}/${pets.id}`)).status).toBe(404);
  });

  it("race: delete vs an expense insert ends consistently, never 500", async () => {
    const outcomes = { deleted: 0, inUse: 0 };
    for (let round = 0; round < 15; round++) {
      const { owner, h } = await setup();
      const cat = await custom(h.id, `Race${round}`);
      const [del, insert] = await Promise.all([
        as(owner).delete(`${base(h.id)}/${cat.id}`),
        // stagger the insert (0-14 ms) so both orders happen: insert first, and delete first
        new Promise((r) => setTimeout(r, round)).then(() => addExpense(h.id, owner.id, cat.id)).then(
          (e) => ({ ok: true as const, id: e.id }),
          (err) => ({ ok: false as const, code: err?.code as string | undefined }),
        ),
      ]);
      expect([204, 409]).toContain(del.status);
      const catExists = (await prisma.category.count({ where: { id: cat.id } })) === 1;
      const expenses = await prisma.expense.count({ where: { categoryId: cat.id } });
      if (del.status === 204) {
        outcomes.deleted++;
        expect(insert.ok).toBe(false);
        expect(catExists).toBe(false);
        expect(expenses).toBe(0);
      } else {
        outcomes.inUse++;
        expect(insert.ok).toBe(true);
        expect(catExists).toBe(true);
        expect(expenses).toBe(1);
      }
    }
    console.log("delete/insert race outcomes:", outcomes);
    expect(outcomes.deleted).toBeGreaterThan(0);
    expect(outcomes.inUse).toBeGreaterThan(0);
  });
});

describe("categories: authorization and ids", () => {
  type Call = (u: { id: number }, hid: string, cid: string) => Promise<{ status: number; body: any }>;
  const routes: [string, Call][] = [
    ["POST /", (u, hid) => as(u).post(`/households/${hid}/categories`).send({ name: "X" })],
    ["GET /", (u, hid) => as(u).get(`/households/${hid}/categories`)],
    ["PATCH /:categoryId", (u, hid, cid) => as(u).patch(`/households/${hid}/categories/${cid}`).send({ name: "X" })],
    ["DELETE /:categoryId", (u, hid, cid) => as(u).delete(`/households/${hid}/categories/${cid}`)],
  ];

  for (const [label, call] of routes) {
    it(`${label}: non-member and former member get 404, nothing changes`, async () => {
      const { h } = await setup();
      const pets = await custom(h.id, "Pets");
      const outsider = await createUser();
      const former = await createUser();
      await addMember(h.id, former.id, "OWNER", { leftAt: new Date() });
      expect((await call(outsider, String(h.id), String(pets.id))).status).toBe(404);
      expect((await call(former, String(h.id), String(pets.id))).status).toBe(404);
      expect(await prisma.category.findUnique({ where: { id: pets.id } })).toMatchObject({ name: "Pets" });
      expect(await prisma.category.count({ where: { householdId: h.id } })).toBe(1);
    });

    for (const id of INVALID_IDS) {
      it(`${label}: invalid household id ${JSON.stringify(id)} returns 400`, async () => {
        const { owner } = await setup();
        const res = await call(owner, encodeURIComponent(id), "1");
        expect(res.status).toBe(400);
        expect(res.body).toStrictEqual({ error: "Invalid id" });
      });
    }
  }

  for (const [label, call] of routes.slice(2)) { // PATCH and DELETE take a :categoryId
    for (const id of INVALID_IDS) {
      it(`${label}: invalid category id ${JSON.stringify(id)} returns 400`, async () => {
        const { owner, h } = await setup();
        const res = await call(owner, String(h.id), encodeURIComponent(id));
        expect(res.status).toBe(400);
        expect(res.body).toStrictEqual({ error: "Invalid id" });
      });
    }
  }

  it("no response (success or error) leaks householdId, emails, cognitoId or another household's data", async () => {
    const { owner, member, h } = await setup();
    const pets = await custom(h.id, "Pets");
    const used = await custom(h.id, "Used");
    await addExpense(h.id, owner.id, used.id);
    const otherOwner = await createUser();
    const h2 = await createHousehold("Elsewhere", otherOwner);
    const secret = await custom(h2.id, "TopSecretCat");

    const responses = [
      await as(member).post(base(h.id)).send({ name: "New" }),
      await as(member).post(base(h.id)).send({ name: "pets" }),
      await as(member).post(base(h.id)).send({ name: "" }),
      await as(member).get(base(h.id)),
      await as(member).get(`${base(h.id)}?includeArchived=true`),
      await as(member).get(`${base(h.id)}?includeArchived=x`),
      await as(member).patch(`${base(h.id)}/${pets.id}`).send({ isArchived: true }),
      await as(member).patch(`${base(h.id)}/${secret.id}`).send({ name: "X" }),
      await as(member).patch(`${base(h.id)}/${other.id}`).send({ name: "X" }),
      await as(member).delete(`${base(h.id)}/${pets.id}`),
      await as(owner).delete(`${base(h.id)}/${secret.id}`),
      await as(owner).delete(`${base(h.id)}/${used.id}`),
      await as(owner).delete(`${base(h.id)}/${other.id}`),
      await as(otherOwner).get(base(h.id)),
      await as(otherOwner).post(base(h.id)).send({ name: "X" }),
    ];
    for (const r of responses) {
      const json = JSON.stringify(r.body);
      expect(json).not.toMatch(/householdId|email|cognitoId|TopSecretCat|Elsewhere/);
      expect(json).not.toContain("@example.com");
      expect(json).not.toContain(`"${h2.id}"`);
    }
  });

  it("every categories route returns 401 without credentials", async () => {
    const { h } = await setup();
    const pets = await custom(h.id, "Pets");
    const results = await Promise.all([
      anon().post(base(h.id)).send({ name: "X" }),
      anon().get(base(h.id)),
      anon().patch(`${base(h.id)}/${pets.id}`).send({ name: "X" }),
      anon().delete(`${base(h.id)}/${pets.id}`),
    ]);
    for (const r of results) expect(r.status).toBe(401);
    expect(await prisma.category.findUnique({ where: { id: pets.id } })).toMatchObject({ name: "Pets" });
  });
});

describe("categories: special characters in names", () => {
  const names = ["%", "_", "100%", "Oth_r", "İstanbul", "Straße"];

  for (const name of names) {
    it(`creates ${JSON.stringify(name)} when no real duplicate exists, and rejects a case-insensitive duplicate of it`, async () => {
      const { owner, h } = await setup();
      const res = await as(owner).post(base(h.id)).send({ name });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe(name);
      const dup = await as(owner).post(base(h.id)).send({ name: name.toUpperCase() === name ? name.toLowerCase() : name.toUpperCase() });
      // "Straße".toUpperCase() is "STRASSE", which lower() does not fold back to "straße": a different name
      expect(dup.status).toBe(name === "Straße" ? 201 : 409);
    });
  }

  it("ß and İ: an exact case-insensitive duplicate is 409", async () => {
    const { owner, h } = await setup();
    expect((await as(owner).post(base(h.id)).send({ name: "Straße" })).status).toBe(201);
    expect((await as(owner).post(base(h.id)).send({ name: "STRAßE" })).status).toBe(409);
    expect((await as(owner).post(base(h.id)).send({ name: "İstanbul" })).status).toBe(201);
    expect((await as(owner).post(base(h.id)).send({ name: "İSTANBUL" })).status).toBe(409);
  });

  it("a true case-insensitive duplicate of a built-in is still 409 on create and rename", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    for (const name of ["OTHER", "oThEr", "rent", "DINING OUT"]) {
      const created = await as(owner).post(base(h.id)).send({ name });
      expect(created.status).toBe(409);
      expect(created.body).toStrictEqual({ error: DUPLICATE });
      const renamed = await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ name });
      expect(renamed.status).toBe(409);
      expect(renamed.body).toStrictEqual({ error: DUPLICATE });
    }
  });

  for (const name of ["%", "Rent%", "_ther", "İstanbul", "Straße"]) {
    it(`renaming to ${JSON.stringify(name)} is allowed when no real duplicate exists`, async () => {
      const { owner, h } = await setup();
      const pets = await custom(h.id, "Pets");
      const res = await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ name });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(name);
    });
  }

  it("renaming to a case-insensitive duplicate with special characters is 409", async () => {
    const { owner, h } = await setup();
    await custom(h.id, "Straße");
    await custom(h.id, "İstanbul");
    const pets = await custom(h.id, "Pets");
    for (const name of ["STRAßE", "İSTANBUL"]) {
      expect((await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ name })).status).toBe(409);
    }
  });
});

describe("categories: list order", () => {
  it("is case-insensitive and stable across calls", async () => {
    const { owner, h } = await setup();
    for (const n of ["zebra", "Apples", "bananas", "Zoo", "apricots", "Cherries"]) await custom(h.id, n);
    const first = (await as(owner).get(base(h.id))).body.map((c: any) => c.name);
    const expected = [...first].sort((a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" }));
    expect(first).toStrictEqual(expected);
    // lowercase names are interleaved with capitalized ones, not grouped after them
    expect(first.indexOf("Apples")).toBeLessThan(first.indexOf("apricots"));
    expect(first.indexOf("apricots")).toBeLessThan(first.indexOf("bananas"));
    expect(first.indexOf("bananas")).toBeLessThan(first.indexOf("Cherries"));
    expect(first.indexOf("zebra")).toBeLessThan(first.indexOf("Zoo"));
    for (let i = 0; i < 3; i++) {
      expect((await as(owner).get(base(h.id))).body.map((c: any) => c.name)).toStrictEqual(first);
    }
  });
});

describe("categories: cap of 100 per household", () => {
  async function fill(householdId: number, count: number, archived = 0) {
    await prisma.category.createMany({
      data: Array.from({ length: count }, (_, i) => ({ householdId, name: `Cap ${i}`, isArchived: i < archived })),
    });
  }

  it("the 101st category gets 409 'Category limit reached'", async () => {
    const { owner, h } = await setup();
    await fill(h.id, 99);
    expect((await as(owner).post(base(h.id)).send({ name: "Hundredth" })).status).toBe(201);
    const res = await as(owner).post(base(h.id)).send({ name: "Too many" });
    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: "Category limit reached" });
    expect(await prisma.category.count({ where: { householdId: h.id } })).toBe(100);
  });

  it("archived categories count toward the cap", async () => {
    const { owner, h } = await setup();
    await fill(h.id, 100, 60);
    const res = await as(owner).post(base(h.id)).send({ name: "Extra" });
    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: "Category limit reached" });
  });

  it("the cap is per household", async () => {
    const { h } = await setup();
    await fill(h.id, 100);
    const otherOwner = await createUser();
    const h2 = await createHousehold("Other", otherOwner);
    expect((await as(otherOwner).post(base(h2.id)).send({ name: "Fine" })).status).toBe(201);
  });

  it("deleting a category frees a slot", async () => {
    const { owner, h } = await setup();
    await fill(h.id, 100);
    const victim = await prisma.category.findFirstOrThrow({ where: { householdId: h.id } });
    expect((await as(owner).delete(`${base(h.id)}/${victim.id}`)).status).toBe(204);
    expect((await as(owner).post(base(h.id)).send({ name: "Fits" })).status).toBe(201);
  });

  it("concurrent creates at the limit never exceed 100 and never 500", async () => {
    for (let round = 0; round < 3; round++) {
      const { owner, member, h } = await setup();
      await fill(h.id, 97);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => as(i % 2 ? owner : member).post(base(h.id)).send({ name: `Concurrent ${i}` })),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);
      for (const r of results.filter((r) => r.status === 409)) expect(r.body).toStrictEqual({ error: "Category limit reached" });
      expect(await prisma.category.count({ where: { householdId: h.id } })).toBe(100);
    }
  });
});

describe("categories: error messages", () => {
  it("isArchived that isn't a boolean names the field", async () => {
    const { owner, h } = await setup();
    const pets = await custom(h.id, "Pets");
    for (const isArchived of ["true", 1, null]) {
      const res = await as(owner).patch(`${base(h.id)}/${pets.id}`).send({ isArchived });
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "isArchived must be true or false" });
    }
  });

  it("built-ins: 403 with 'Built-in categories can't be changed/deleted'", async () => {
    const { owner, h } = await setup();
    const patch = await as(owner).patch(`${base(h.id)}/${other.id}`).send({ name: "Misc" });
    expect(patch.body).toStrictEqual({ error: "Built-in categories can't be changed" });
    const del = await as(owner).delete(`${base(h.id)}/${other.id}`);
    expect(del.body).toStrictEqual({ error: "Built-in categories can't be deleted" });
  });

  it("missing or foreign category: 404 'Category not found'", async () => {
    const { owner, h } = await setup();
    const h2 = await createHousehold("Other", await createUser());
    const secret = await custom(h2.id, "Secret");
    for (const id of [secret.id, MAX_ID]) {
      expect((await as(owner).patch(`${base(h.id)}/${id}`).send({ name: "X" })).body).toStrictEqual({ error: "Category not found" });
      expect((await as(owner).delete(`${base(h.id)}/${id}`)).body).toStrictEqual({ error: "Category not found" });
    }
  });
});

describe("categories: another household's category", () => {
  it("rename, archive and unarchive of another household's category are 404 and change nothing", async () => {
    const { owner, member, h } = await setup();
    const h2 = await createHousehold("Other", await createUser());
    const secret = await custom(h2.id, "Secret");
    const archivedSecret = await custom(h2.id, "Hidden", true);
    for (const u of [owner, member]) {
      expect((await as(u).patch(`${base(h.id)}/${secret.id}`).send({ name: "Mine" })).status).toBe(404);
      expect((await as(u).patch(`${base(h.id)}/${secret.id}`).send({ isArchived: true })).status).toBe(404);
      expect((await as(u).patch(`${base(h.id)}/${archivedSecret.id}`).send({ isArchived: false })).status).toBe(404);
    }
    expect(await prisma.category.findUnique({ where: { id: secret.id } })).toMatchObject({ name: "Secret", isArchived: false, householdId: h2.id });
    expect(await prisma.category.findUnique({ where: { id: archivedSecret.id } })).toMatchObject({ isArchived: true, householdId: h2.id });
  });
});
