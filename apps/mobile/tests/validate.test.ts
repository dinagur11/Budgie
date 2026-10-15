import { describe, it, expect } from "vitest";
import { validateCode, validateConfirmPassword, validateEmail, validateLoginPassword, validateName, validateNewPassword } from "../src/lib/validate";

describe("validators", () => {
  it("email", () => {
    expect(validateEmail("")).toBe("Enter your email");
    expect(validateEmail("   ")).toBe("Enter your email");
    expect(validateEmail("dana")).toBe("Enter a valid email address");
    expect(validateEmail("dana@example")).toBe("Enter a valid email address");
    expect(validateEmail("a b@example.com")).toBe("Enter a valid email address");
    expect(validateEmail(" dana@example.com ")).toBeNull();
  });

  it("login password only needs to be non-empty", () => {
    expect(validateLoginPassword("")).toBe("Enter your password");
    expect(validateLoginPassword("x")).toBeNull();
  });

  it("new password follows the Cognito default policy", () => {
    expect(validateNewPassword("Ab1!")).toBe("Use at least 8 characters");
    expect(validateNewPassword("ABCDEFG1!")).toBe("Add a lowercase letter");
    expect(validateNewPassword("abcdefg1!")).toBe("Add an uppercase letter");
    expect(validateNewPassword("Abcdefgh!")).toBe("Add a number");
    expect(validateNewPassword("Abcdefgh1")).toBe("Add a symbol");
    expect(validateNewPassword("Abcdefg1!")).toBeNull();
    expect(validateNewPassword("Abcd efg1")).toBeNull(); // a space counts as a symbol
  });

  it("confirm password", () => {
    expect(validateConfirmPassword("Abcdefg1!", "")).toBe("Repeat your password");
    expect(validateConfirmPassword("Abcdefg1!", "Abcdefg1?")).toBe("Passwords don't match");
    expect(validateConfirmPassword("Abcdefg1!", "Abcdefg1!")).toBeNull();
  });

  it("name: trimmed, 1 to 100 characters (same as the backend)", () => {
    expect(validateName("")).toBe("Enter your name");
    expect(validateName("   ")).toBe("Enter your name");
    expect(validateName("  Dana  ")).toBeNull();
    expect(validateName("a".repeat(100))).toBeNull();
    expect(validateName(" " + "a".repeat(100) + " ")).toBeNull();
    expect(validateName("a".repeat(101))).toBe("Use at most 100 characters");
    expect(validateName("", "Enter a name")).toBe("Enter a name");
  });

  it("confirmation code: exactly 6 digits", () => {
    expect(validateCode("123456")).toBeNull();
    expect(validateCode(" 123456 ")).toBeNull();
    expect(validateCode("12345")).toBe("Enter the 6-digit code");
    expect(validateCode("1234567")).toBe("Enter the 6-digit code");
    expect(validateCode("12345a")).toBe("Enter the 6-digit code");
  });
});
