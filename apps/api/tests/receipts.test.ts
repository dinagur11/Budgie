import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, as, anon, createUser, createHousehold, addMember, INVALID_IDS, expectNoSensitiveFields } from "./helpers.js";
import { validReceiptKey } from "../src/lib/validate.js";
import { config } from "../src/config.js";

// No real AWS: the presigner returns a fake URL and records the command it was given.
const { getSignedUrl } = vi.hoisted(() => ({
  getSignedUrl: vi.fn(async (..._args: unknown[]) => "https://example.test/upload?X-Amz-Signature=fake"),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VALID = { contentType: "image/jpeg", byteSize: 123456 };

beforeEach(() => {
  getSignedUrl.mockClear();
});

async function setup() {
  const owner = await createUser("Owner");
  const member = await createUser("Member");
  const h = await createHousehold("Home", owner);
  await addMember(h.id, member.id);
  return { owner, member, h };
}

const upload = (user: { id: number }, householdId: number | string, body?: unknown) => {
  const req = as(user).post(`/households/${householdId}/receipts`);
  return body === undefined ? req : req.send(body as object);
};

// the PutObjectCommand passed to the last getSignedUrl call
function lastCommandInput() {
  const call = getSignedUrl.mock.calls.at(-1)!;
  return (call[1] as { input: Record<string, unknown> }).input;
}

async function countAll() {
  const [users, households, members, expenses, rules, categories, invites] = await Promise.all([
    prisma.user.count(),
    prisma.household.count(),
    prisma.householdMember.count(),
    prisma.expense.count(),
    prisma.recurringRule.count(),
    prisma.category.count(),
    prisma.invite.count(),
  ]);
  return { users, households, members, expenses, rules, categories, invites };
}

describe("POST /households/:id/receipts", () => {
  it("returns exactly { key, uploadUrl, expiresAt }", async () => {
    const { member, h } = await setup();
    const before = Date.now();
    const res = await upload(member, h.id, VALID);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["expiresAt", "key", "uploadUrl"]);
    expect(res.body.uploadUrl).toBe("https://example.test/upload?X-Amz-Signature=fake");
    expect(typeof res.body.expiresAt).toBe("string");
    expect(new Date(res.body.expiresAt).toISOString()).toBe(res.body.expiresAt);
    const ttl = new Date(res.body.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(290_000);
    expect(ttl).toBeLessThanOrEqual(305_000);
    expectNoSensitiveFields(res.body);
  });

  it("presigns a PutObjectCommand with the bucket, key, content type and length, for 300 seconds", async () => {
    const { owner, h } = await setup();
    const res = await upload(owner, h.id, { contentType: "image/jpeg", byteSize: 5_000_000 });
    expect(res.status).toBe(200);
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const [, command, options] = getSignedUrl.mock.calls[0] as [unknown, any, any];
    expect(command.constructor.name).toBe("PutObjectCommand");
    const { Bucket, ...rest } = command.input;
    // compared as a boolean so a failure never prints the configured bucket name
    expect(Bucket === config.s3ReceiptsBucket).toBe(true);
    expect(rest).toStrictEqual({
      Key: res.body.key,
      ContentType: "image/jpeg",
      ContentLength: 5_000_000,
    });
    expect(options.expiresIn).toBe(300);
    expect([...options.signableHeaders].sort()).toEqual(["content-length", "content-type"]);
  });

  it("the key uses the caller's household id and a fresh uuid each call, and passes validReceiptKey", async () => {
    const { member, h } = await setup();
    const keys = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const res = await upload(member, h.id, { ...VALID, householdId: 999 });
      expect(res.status).toBe(200);
      const key: string = res.body.key;
      const [prefix, householdPart, file] = key.split("/");
      expect(prefix).toBe("receipts");
      expect(householdPart).toBe(String(h.id));
      expect(file.endsWith(".jpg")).toBe(true);
      expect(file.slice(0, -4)).toMatch(UUID);
      expect(lastCommandInput().Key).toBe(key);
      expect(validReceiptKey(key, h.id)).toBe(key);
      // a key for one household is not valid for another
      expect(() => validReceiptKey(key, h.id + 1)).toThrow("Invalid key");
      keys.add(key);
    }
    expect(keys.size).toBe(3);
  });

  it("writes nothing to the database", async () => {
    const { member, h } = await setup();
    const before = await countAll();
    expect((await upload(member, h.id, VALID)).status).toBe(200);
    expect(await countAll()).toEqual(before);
  });

  describe("validation", () => {
    it("missing body", async () => {
      const { member, h } = await setup();
      const res = await upload(member, h.id);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid content type" });
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it.each([undefined, null, "image/png", "image/heic", "IMAGE/JPEG", "image/jpg", " image/jpeg", "image/jpeg; charset=x", 1, ["image/jpeg"]])(
      "contentType %j is 400",
      async (contentType) => {
        const { member, h } = await setup();
        const res = await upload(member, h.id, { contentType, byteSize: 1000 });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "Invalid content type" });
        expect(getSignedUrl).not.toHaveBeenCalled();
      },
    );

    it.each([undefined, null, 0, -1, 1.5, "100", 5_000_001, 1e20, Number.MAX_SAFE_INTEGER, true, [100]])(
      "byteSize %j is 400",
      async (byteSize) => {
        const { member, h } = await setup();
        const res = await upload(member, h.id, { contentType: "image/jpeg", byteSize });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "Invalid size" });
        expect(getSignedUrl).not.toHaveBeenCalled();
      },
    );

    it("accepts the bounds 1 and 5,000,000", async () => {
      const { member, h } = await setup();
      expect((await upload(member, h.id, { contentType: "image/jpeg", byteSize: 1 })).status).toBe(200);
      expect((await upload(member, h.id, { contentType: "image/jpeg", byteSize: 5_000_000 })).status).toBe(200);
    });

    it.each(INVALID_IDS)("invalid household id %j is 400", async (id) => {
      const { member } = await setup();
      const res = await upload(member, encodeURIComponent(id), VALID);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid id" });
    });
  });

  describe("authorization", () => {
    it("401 without credentials", async () => {
      const { h } = await setup();
      const res = await anon().post(`/households/${h.id}/receipts`).send(VALID);
      expect(res.status).toBe(401);
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it("404 for a non-member", async () => {
      const { h } = await setup();
      const stranger = await createUser("Stranger");
      const res = await upload(stranger, h.id, VALID);
      expect(res.status).toBe(404);
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it("404 for a missing household", async () => {
      const { member } = await setup();
      expect((await upload(member, 2147483647, VALID)).status).toBe(404);
    });

    it("404 for a user who left", async () => {
      const { member, h } = await setup();
      expect((await as(member).delete(`/households/${h.id}/members/me`)).status).toBe(204);
      const res = await upload(member, h.id, VALID);
      expect(res.status).toBe(404);
      expect(getSignedUrl).not.toHaveBeenCalled();
    });
  });
});

describe("daily receipt cap on upload", () => {
  const todayUtc = () => new Date().toISOString().slice(0, 10);
  const scan = (userId: number, day: string) => prisma.receiptScan.create({ data: { userId, day: new Date(day) } });

  it("429 once the user has used 3 scans today, without presigning", async () => {
    const { member, h } = await setup();
    for (let i = 0; i < 3; i++) await scan(member.id, todayUtc());
    const res = await upload(member, h.id, VALID);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Daily receipt limit reached" });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it("2 scans today still allow an upload; older days don't count", async () => {
    const { member, h } = await setup();
    await scan(member.id, todayUtc());
    await scan(member.id, todayUtc());
    for (let i = 0; i < 3; i++) await scan(member.id, "2026-01-01");
    expect((await upload(member, h.id, VALID)).status).toBe(200);
  });

  it("a premium user can upload after 3 scans and gets 429 after 10", async () => {
    const { member, h } = await setup();
    await prisma.user.update({ where: { id: member.id }, data: { isPremium: true } });
    for (let i = 0; i < 3; i++) await scan(member.id, todayUtc());
    expect((await upload(member, h.id, VALID)).status).toBe(200);
    for (let i = 0; i < 7; i++) await scan(member.id, todayUtc());
    const res = await upload(member, h.id, VALID);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Daily receipt limit reached" });
  });

  it("is per user, across households", async () => {
    const { owner, member, h } = await setup();
    const other = await createHousehold("Other", member);
    for (let i = 0; i < 3; i++) await scan(member.id, todayUtc());
    expect((await upload(member, other.id, VALID)).status).toBe(429);
    expect((await upload(owner, h.id, VALID)).status).toBe(200);
  });

  it("'today' is the household's date: scans dated tomorrow in UTC don't count for a household behind UTC", async () => {
    const { member, h } = await setup();
    // Pacific/Kiritimati is UTC+14, so its today is on or after the UTC date; Pacific/Pago_Pago (UTC-11) is on or before it
    await prisma.household.update({ where: { id: h.id }, data: { timeZone: "Pacific/Pago_Pago" } });
    const kiritimatiToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(new Date());
    const pagoToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Pago_Pago" }).format(new Date());
    expect(kiritimatiToday > pagoToday).toBe(true); // 25 hours apart, so always different dates
    for (let i = 0; i < 3; i++) await scan(member.id, kiritimatiToday);
    expect((await upload(member, h.id, VALID)).status).toBe(200);
    for (let i = 0; i < 3; i++) await scan(member.id, pagoToday);
    expect((await upload(member, h.id, VALID)).status).toBe(429);
  });
});
