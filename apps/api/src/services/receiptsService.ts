import { Currency, Prisma } from "../../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";
import { HttpError } from "../middleware/errorHandler.js";
import { extractReceipt, RawReceiptExtraction } from "../lib/llm/receiptExtractor.js";
import { todayInTimeZone } from "../services/expensesService.js";
import { prisma } from "../prisma.js";
import { MAX_RECEIPT_BYTES } from "../lib/validate.js";

export type ReceiptSuggestion = {
  isReceipt: boolean;
  name: string | null;        // merchant, trimmed, max 100 chars
  amount: number | null;      // minor units, integer 1..2147483647
  currency: Currency | null;
  date: string | null;        // YYYY-MM-DD, never in the future
  categoryId: number | null;  // built-in or the household's, not archived
  description: string | null; // trimmed, max 500 chars
};

export const NOT_A_RECEIPT: ReceiptSuggestion = {
  isReceipt: false,
  name: null,
  amount: null,
  currency: null,
  date: null,
  categoryId: null,
  description: null,
};

// WHEN_REQUIRED: otherwise the SDK puts a CRC32 of an empty body into presigned PUT URLs and S3 rejects the real upload
const s3 = new S3Client({ region: config.awsRegion, requestChecksumCalculation: "WHEN_REQUIRED" });

const UPLOAD_URL_TTL_SECONDS = 300;

// analyses per user per day (the scanning household's local date), across all their households
export const MAX_RECEIPTS_PER_DAY = 3;
const LIMIT_MESSAGE = "Daily receipt limit reached";

async function scansToday(userId: number, today: string, tx: Prisma.TransactionClient = prisma) {
  return tx.receiptScan.count({ where: { userId, day: new Date(today) } });
}

// Upload check only: tells the app before it uploads. The real guard is reserveScan in analyze.
async function assertScansLeft(userId: number, householdId: number) {
  const household = await prisma.household.findUnique({ where: { id: householdId }, select: { timeZone: true } });
  if (!household) throw new HttpError(404, "Household not found");
  if (await scansToday(userId, todayInTimeZone(household.timeZone)) >= MAX_RECEIPTS_PER_DAY)
    throw new HttpError(429, LIMIT_MESSAGE);
}

// Records one analysis before the LLM call. Locks the user row so two concurrent analyses can't both take the last scan.
async function reserveScan(userId: number, today: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (await scansToday(userId, today, tx) >= MAX_RECEIPTS_PER_DAY) throw new HttpError(429, LIMIT_MESSAGE);
    await tx.receiptScan.create({ data: { userId, day: new Date(today) } });
  });
}

export type ReceiptUploadInput = {
  contentType: "image/jpeg";
  byteSize: number;
};

export type ReceiptUpload = {
  key: string;
  uploadUrl: string;
  expiresAt: string; // ISO timestamp
};

// A presigned PUT for one receipt image. Writes nothing to the database; 429 when the user has no scans left today.
export async function createReceiptUpload(householdId: number, userId: number, input: ReceiptUploadInput): Promise<ReceiptUpload> {
  await assertScansLeft(userId, householdId);
  const key = `receipts/${householdId}/${randomUUID()}.jpg`;
  const command = new PutObjectCommand({
    Bucket: config.s3ReceiptsBucket,
    Key: key,
    ContentType: input.contentType,
    ContentLength: input.byteSize,
  });
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
  // content-length is signed by default; content-type only when listed, so S3 rejects an upload with another type or size
  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { key, uploadUrl, expiresAt };
}

// Only an analysis that reaches the LLM uses up a scan (a missing or invalid image doesn't); the image is deleted either way.
export async function analyzeReceipt(householdId: number, userId: number, key: string): Promise<ReceiptSuggestion> {
  try {
    const household = await prisma.household.findUnique({
      where: { id: householdId },
      select: { timeZone: true, defaultCurrency: true },
    });
    if (!household) throw new HttpError(404, "Household not found");

    const categories = await prisma.category.findMany({
      where: { isArchived: false, OR: [{ householdId: null }, { householdId }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const image = await downloadReceipt(key);
    const today = todayInTimeZone(household.timeZone);
    await reserveScan(userId, today);

    let raw: RawReceiptExtraction;
    try {
      raw = await extractReceipt(image, {
        categories,
        today,
        householdCurrency: household.defaultCurrency,
      });
    } catch (err) {
      // log only the kind of failure, never the image or the model's answer
      console.error("Receipt extraction failed:", err instanceof Error ? err.name : "unknown error");
      throw new HttpError(502, "Couldn't read the receipt");
    }

    return toSuggestion(raw, new Set(categories.map((c) => c.id)), today);
  } finally {
    await deleteReceipt(key);
  }
}

async function downloadReceipt(key: string): Promise<Buffer> {
  const Bucket = config.s3ReceiptsBucket;
  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
  } catch (err) {
    if (err instanceof Error && (err.name === "NotFound" || err.name === "NoSuchKey")) {
      throw new HttpError(404, "Receipt not found");
    }
    throw err;
  }
  const size = head.ContentLength ?? 0;
  if (size < 1)
    throw new HttpError(400, "Invalid image");
  if (size > MAX_RECEIPT_BYTES)
    throw new HttpError(400, "Receipt image is too large");

  // 2. Download it
  const object = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  if (!object.Body) throw new HttpError(404, "Receipt not found");
  const bytes = await object.Body.transformToByteArray();
  if (bytes.length > MAX_RECEIPT_BYTES) throw new HttpError(400, "Receipt image is too large");

  return Buffer.from(bytes);
}

async function deleteReceipt(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: config.s3ReceiptsBucket, Key: key }));
  } catch (err) {
    console.error("Receipt cleanup failed:", err instanceof Error ? err.name : "unknown error");
  }
}

const MAX_AMOUNT = 2_147_483_647;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
  return text === "" ? null : text;
}

function cleanAmount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const minor = Math.round(value * 100); // every currency in your enum has 2 decimals
  return minor >= 1 && minor <= MAX_AMOUNT ? minor : null;
}

function cleanCurrency(value: unknown): Currency | null {
  return typeof value === "string" && (Object.values(Currency) as string[]).includes(value)
    ? (value as Currency)
    : null;
}

function cleanDate(value: unknown, today: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 2000 || y > 2100) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null; // not a real day, no rollover such as 2026-02-30
  }
  return value > today ? null : value; // YYYY-MM-DD strings compare correctly as text
}

function cleanCategoryId(value: unknown, allowed: Set<number>): number | null {
  return typeof value === "number" && Number.isInteger(value) && allowed.has(value) ? value : null;
}

function toSuggestion(
  raw: RawReceiptExtraction,
  allowedCategories: Set<number>,
  today: string,
): ReceiptSuggestion {
  if (raw.isReceipt !== true) return NOT_A_RECEIPT;

  const name = cleanText(raw.name, 100);
  const amount = cleanAmount(raw.amount);
  // nothing usable was read: same as "not a receipt", so the app asks for another photo
  if (name === null && amount === null) return NOT_A_RECEIPT;

  return {
    isReceipt: true,
    name,
    amount,
    currency: cleanCurrency(raw.currency),
    date: cleanDate(raw.date, today),
    categoryId: cleanCategoryId(raw.categoryId, allowedCategories),
    description: cleanText(raw.description, 500),
  };
}