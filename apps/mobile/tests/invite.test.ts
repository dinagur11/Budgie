import { describe, it, expect } from "vitest";
import { inviteErrorMessage, inviteLink, inviteMessage, isFinalInviteError, tokenFromInviteUrl } from "../src/lib/invite";
import { ApiError } from "../src/api/errors";

const TOKEN = "abc-DEF_123";

describe("invite links", () => {
  it("puts the token in the fragment of an https join link", () => {
    expect(inviteLink(TOKEN)).toBe("https://dinagur11.github.io/join#token=abc-DEF_123");
  });
  it("the message names the household and the expiry", () => {
    expect(inviteMessage("Home", "https://dinagur11.github.io/join#token=x", "Oct 22, 2026")).toBe(
      'Join "Home" on Budgie: https://dinagur11.github.io/join#token=x\nThis link works once and expires on Oct 22, 2026.',
    );
  });
});

describe("tokenFromInviteUrl", () => {
  it("reads the links it builds", () => {
    expect(tokenFromInviteUrl(inviteLink(TOKEN))).toBe(TOKEN);
  });
  it("accepts a trailing slash, a query string and the budgie:// scheme", () => {
    expect(tokenFromInviteUrl(`https://dinagur11.github.io/join/#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromInviteUrl(`https://DINAGUR11.github.io/join?token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromInviteUrl(`budgie://join?token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromInviteUrl(`budgie:///join?token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromInviteUrl(`budgie://join?x=1&token=${TOKEN}`)).toBe(TOKEN);
  });
  it("rejects other hosts, paths and schemes", () => {
    expect(tokenFromInviteUrl(`https://evil.example/join#token=${TOKEN}`)).toBeNull();
    expect(tokenFromInviteUrl(`https://dinagur11.github.io.evil.example/join#token=${TOKEN}`)).toBeNull();
    expect(tokenFromInviteUrl(`https://dinagur11.github.io/joinx#token=${TOKEN}`)).toBeNull();
    expect(tokenFromInviteUrl(`http://dinagur11.github.io/join#token=${TOKEN}`)).toBeNull();
    expect(tokenFromInviteUrl(`budgie://household/1`)).toBeNull();
    expect(tokenFromInviteUrl(`/household/1`)).toBeNull();
  });
  it("rejects a missing, empty, over-long or non-base64url token", () => {
    expect(tokenFromInviteUrl("https://dinagur11.github.io/join")).toBeNull();
    expect(tokenFromInviteUrl("https://dinagur11.github.io/join#token=")).toBeNull();
    expect(tokenFromInviteUrl(`https://dinagur11.github.io/join#token=${"a".repeat(129)}`)).toBeNull();
    expect(tokenFromInviteUrl("https://dinagur11.github.io/join#token=a%2Fb")).toBeNull();
    expect(tokenFromInviteUrl("https://dinagur11.github.io/join#token=%E0%A4%A")).toBeNull();
  });
});

describe("invite errors", () => {
  it("maps the backend's join errors", () => {
    expect(inviteErrorMessage(new ApiError(404, "Invite not found"))).toBe("This invite link isn't valid. Ask for a new one.");
    expect(inviteErrorMessage(new ApiError(400, "Invalid token"))).toBe("This invite link isn't valid. Ask for a new one.");
    expect(inviteErrorMessage(new ApiError(410, "Invite has expired"))).toBe("This invite has expired. Ask for a new one.");
    expect(inviteErrorMessage(new ApiError(410, "Invite was already used"))).toBe("This invite was already used. Each link works once, so ask for a new one.");
    expect(inviteErrorMessage(new ApiError(409, "Already a member of this household"))).toBe("You're already a member of this household.");
    expect(inviteErrorMessage(new ApiError(0, "x"))).toBe("Can't reach the server. Check your connection and try again.");
  });
  it("only network and server errors are worth retrying", () => {
    expect(isFinalInviteError(new ApiError(410, "Invite has expired"))).toBe(true);
    expect(isFinalInviteError(new ApiError(409, "Already a member of this household"))).toBe(true);
    expect(isFinalInviteError(new ApiError(0, "x"))).toBe(false);
    expect(isFinalInviteError(new ApiError(500, "Internal server error"))).toBe(false);
  });
});
