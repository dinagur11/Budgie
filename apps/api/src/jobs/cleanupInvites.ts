// Daily Railway cron job (settings in the Railway dashboard, see CLAUDE.md Hosting): deletes old invites, then exits.
// Imports only the Prisma client, not config.ts, so the cron service needs DATABASE_URL and nothing else.
import { prisma } from "../prisma.js";
import { cleanupInvites } from "../services/invitesService.js";

if (!process.env.DATABASE_URL) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

try {
  const count = await cleanupInvites();
  console.log(`Invite cleanup: deleted ${count} invites`);
} catch (e) {
  console.error("Invite cleanup failed:", e instanceof Error ? e.name : "unknown error");
  process.exitCode = 1;
} finally {
  // the process must exit, otherwise Railway skips the next scheduled run
  await prisma.$disconnect();
}
