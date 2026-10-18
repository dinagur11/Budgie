import { analyzeReceipt } from "../src/services/receiptsService.js";
import { prisma } from "../src/prisma.js";

const householdId = 1;
const userId = 1; // uses up one of this user's daily scans
const key = "receipts/1/receipt-test.jpg";

try {
  console.log(JSON.stringify(await analyzeReceipt(householdId, userId, key), null, 2));
} catch (err) {
  console.error("Failed:", (err as { status?: number }).status, (err as Error).message);
} finally {
  await prisma.$disconnect();
  process.exit(0);
}