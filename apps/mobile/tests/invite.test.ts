import { describe, it, expect } from "vitest";
import { inviteLink, inviteMessage } from "../src/lib/invite";

describe("invite links", () => {
  it("puts the token in a budgie:// join link", () => {
    expect(inviteLink("abc-DEF_123")).toBe("budgie://join?token=abc-DEF_123");
  });
  it("the message names the household and the expiry", () => {
    expect(inviteMessage("Home", "budgie://join?token=x", "Oct 22, 2026")).toBe(
      'Join "Home" on Budgie: budgie://join?token=x\nThis link works once and expires on Oct 22, 2026.',
    );
  });
});
