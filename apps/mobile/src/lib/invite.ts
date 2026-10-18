import { ApiError, NETWORK_ERROR_MESSAGE, errorMessage } from "../api/errors";

// Invite links are https App Links on the GitHub Pages site in apps/invite-site (published as the dinagur11.github.io
// repo). With the app installed, Android opens the link in the app (the intent filter in app.json, verified through the
// site's /.well-known/assetlinks.json); without it, the browser shows the site's /join page, which sends you to the
// Play Store. The token is in the fragment, which browsers never send to a server, so it stays out of the site's logs.
export const INVITE_HOST = "dinagur11.github.io";

// The token is base64url, so it needs no escaping, but encoding keeps the link safe anyway.
export function inviteLink(token: string): string {
  return `https://${INVITE_HOST}/join#token=${encodeURIComponent(token)}`;
}

// the text the share sheet sends, with the expiry from POST /households/:id/invites ("Oct 22, 2026")
export function inviteMessage(householdName: string, link: string, expires: string): string {
  return `Join "${householdName}" on Budgie: ${link}\nThis link works once and expires on ${expires}.`;
}

// same bounds as the backend's "Invalid token" check, and only base64url characters
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

// The token from an incoming invite URL, or null if the URL isn't an invite. Accepts the shared link
// (https://<INVITE_HOST>/join#token=…, with or without a trailing slash, or ?token=), and budgie://join?token=…
// (the site's "Open in Budgie" button, and links shared before the switch to https).
export function tokenFromInviteUrl(url: string): string | null {
  const m = /^(?:https:\/\/([^/?#]+)\/join\/?|budgie:\/\/\/?join\/?)([?#].*)?$/i.exec(url.trim());
  if (!m) return null;
  if (m[1] !== undefined && m[1].toLowerCase() !== INVITE_HOST) return null;
  const params = (m[2] ?? "").slice(1);
  for (const part of params.split(/[&#?]/)) {
    const [name, value] = part.split("=");
    if (name !== "token" || value === undefined) continue;
    let token: string;
    try {
      token = decodeURIComponent(value);
    } catch {
      return null;
    }
    return TOKEN.test(token) ? token : null;
  }
  return null;
}

// what the join screen shows when the preview or the join fails
export function inviteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return NETWORK_ERROR_MESSAGE;
    if (error.status === 400 || (error.status === 404 && error.message === "Invite not found"))
      return "This invite link isn't valid. Ask for a new one.";
    if (error.status === 410 && error.message === "Invite has expired") return "This invite has expired. Ask for a new one.";
    if (error.status === 410) return "This invite was already used. Each link works once, so ask for a new one.";
    if (error.status === 409) return "You're already a member of this household.";
  }
  return errorMessage(error);
}

// the invite itself is the problem (invalid, expired, used, already a member): trying again won't help
export function isFinalInviteError(error: unknown): boolean {
  return error instanceof ApiError && [400, 404, 409, 410].includes(error.status);
}
