// The link an owner shares. The app opens budgie:// links (the "scheme" in app.json); the join screen that reads
// the token is not built yet. The token is base64url, so it needs no escaping, but encoding keeps the link safe anyway.
export function inviteLink(token: string): string {
  return `budgie://join?token=${encodeURIComponent(token)}`;
}

// the text the share sheet sends, with the expiry from POST /households/:id/invites ("Oct 22, 2026")
export function inviteMessage(householdName: string, link: string, expires: string): string {
  return `Join "${householdName}" on Budgie: ${link}\nThis link works once and expires on ${expires}.`;
}
