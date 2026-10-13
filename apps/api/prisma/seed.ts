// prisma/seed.ts
import { prisma } from "../src/prisma.js"; 

const DEFAULT_CATEGORIES = [
  "Groceries", "Rent", "Utilities", "Transport",
  "Dining out", "Health", "Entertainment", "Other",
];

async function main() {
  for (const name of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { householdId: null, name },
    });
    if (!existing) {
      await prisma.category.create({ data: { name } });
    }
  }
}

main().finally(() => prisma.$disconnect());