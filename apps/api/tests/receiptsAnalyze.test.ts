import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, as, createUser, createHousehold } from "./helpers.js";

// No real AWS or OpenAI: S3 holds images in a Map, the extractor returns a fixed answer.
const { objects, deleted, extractReceipt } = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  deleted: [] as string[],
  extractReceipt: vi.fn(async (..._args: unknown[]) => ({ isReceipt: true, name: "Shop", amount: 12.5, currency: "USD" })),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(public input: { Key: string }) {} }
  class HeadObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class DeleteObjectCommand extends Command {}
  class PutObjectCommand extends Command {}
  class S3Client {
    async send(command: Command) {
      const key = command.input.Key;
      if (command instanceof DeleteObjectCommand) { deleted.push(key); objects.delete(key); return {}; }
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(new Error("missing"), { name: "NotFound" });
      if (command instanceof HeadObjectCommand) return { ContentLength: bytes.length };
      return { Body: { transformToByteArray: async () => bytes } };
    }
  }
  return { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, PutObjectCommand };
});
vi.mock("../src/lib/llm/receiptExtractor.js", () => ({ extractReceipt }));

beforeEach(() => {
  objects.clear();
  deleted.length = 0;
  extractReceipt.mockClear();
});

let n = 0;
function putImage(householdId: number) {
  n += 1;
  const key = `receipts/${householdId}/00000000-0000-4000-8000-${String(n).padStart(12, "0")}.jpg`;
  objects.set(key, new Uint8Array([1, 2, 3]));
  return key;
}

async function setup() {
  const user = await createUser("Scanner");
  const h = await createHousehold("Home", user);
  return { user, h };
}

const analyze = (user: { id: number }, householdId: number, key: string) =>
  as(user).post(`/households/${householdId}/receipts/analyze`).send({ key });

describe("POST /households/:id/receipts/analyze, daily cap", () => {
  it("3 analyses succeed and are recorded; the 4th is 429, skips the model and still deletes the image", async () => {
    const { user, h } = await setup();
    for (let i = 0; i < 3; i++) {
      const res = await analyze(user, h.id, putImage(h.id));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ isReceipt: true, name: "Shop", amount: 1250 });
    }
    expect(await prisma.receiptScan.count({ where: { userId: user.id } })).toBe(3);

    const key = putImage(h.id);
    const res = await analyze(user, h.id, key);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Daily receipt limit reached" });
    expect(extractReceipt).toHaveBeenCalledTimes(3);
    expect(deleted).toContain(key);
    expect(await prisma.receiptScan.count({ where: { userId: user.id } })).toBe(3);
  });

  it("a missing image (404) doesn't use up a scan", async () => {
    const { user, h } = await setup();
    const res = await analyze(user, h.id, `receipts/${h.id}/00000000-0000-4000-8000-999999999999.jpg`);
    expect(res.status).toBe(404);
    expect(await prisma.receiptScan.count()).toBe(0);
  });

  it("a model failure (502) and 'not a receipt' both use up a scan", async () => {
    const { user, h } = await setup();
    extractReceipt.mockRejectedValueOnce(new Error("boom"));
    expect((await analyze(user, h.id, putImage(h.id))).status).toBe(502);
    extractReceipt.mockResolvedValueOnce({ isReceipt: false } as never);
    const res = await analyze(user, h.id, putImage(h.id));
    expect(res.status).toBe(200);
    expect(res.body.isReceipt).toBe(false);
    expect(await prisma.receiptScan.count({ where: { userId: user.id } })).toBe(2);
  });

  it("concurrent analyses: exactly 3 succeed, the rest are 429 (never 500)", async () => {
    const { user, h } = await setup();
    const keys = Array.from({ length: 6 }, () => putImage(h.id));
    const statuses = (await Promise.all(keys.map((k) => analyze(user, h.id, k)))).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);
    expect(await prisma.receiptScan.count({ where: { userId: user.id } })).toBe(3);
    expect(deleted.sort()).toEqual([...keys].sort());
  });
});
