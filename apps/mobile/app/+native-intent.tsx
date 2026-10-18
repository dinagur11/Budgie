import { setPendingInvite } from "../src/invite/pendingInvite";
import { tokenFromInviteUrl } from "../src/lib/invite";

// Incoming links: an invite link only keeps its token aside (never in a route). OpenPendingInvite in the root layout
// then opens the join screen, right away when signed in, or after sign-in. On a cold start the app opens on the
// households list underneath; a link that arrives while the app runs leaves the current screen as it is.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    const token = tokenFromInviteUrl(path);
    if (token === null) return path;
    setPendingInvite(token);
    return initial ? "/" : null;
  } catch {
    return path;
  }
}
