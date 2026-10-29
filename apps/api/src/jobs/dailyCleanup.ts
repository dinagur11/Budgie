// Daily Railway cron job (settings in the Railway dashboard, see CLAUDE.md Hosting): deletes old invites and resets
// ended premium subscriptions, then exits. Imports only the Prisma client, not config.ts, so the cron service needs
// DATABASE_URL and nothing else.
import { prisma } from "../prisma.js";
import { cleanupInvites } from "../services/invitesService.js";
import { expirePremium } from "../services/premiumService.js";

if (!process.env.DATABASE_URL) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

// each step runs even if the other fails
const steps: [string, () => Promise<number>, string][] = [
  ["Invite cleanup", cleanupInvites, "deleted %d invites"],
  ["Premium cleanup", expirePremium, "ended %d subscriptions"],
];

try {
  for (const [label, run, done] of steps) {
    try {
      console.log(`${label}: ${done.replace("%d", String(await run()))}`);
    } catch (e) {
      console.error(`${label} failed:`, e instanceof Error ? e.name : "unknown error");
      process.exitCode = 1;
    }
  }
} finally {
  // the process must exit, otherwise Railway skips the next scheduled run
  await prisma.$disconnect();
}
