import { describe, it, expect } from "vitest";
import { authErrorMessage } from "../src/auth/errors";

const err = (name: string, message = "x") => Object.assign(new Error(message), { name });

describe("authErrorMessage", () => {
  it("sign-in failures don't reveal whether the email exists", () => {
    expect(authErrorMessage(err("UserNotFoundException"))).toBe("Incorrect email or password");
    expect(authErrorMessage(err("NotAuthorizedException"))).toBe("Incorrect email or password");
  });

  it("NotAuthorizedException outside sign-in is not a wrong password", () => {
    expect(authErrorMessage(err("NotAuthorizedException", "SignUp is not permitted for this user pool"), "signUp")).toMatch(/can't be created/);
    expect(authErrorMessage(err("NotAuthorizedException", "Unable to verify secret hash for client abc"), "signUp")).toMatch(/isn't set up/);
    expect(authErrorMessage(err("NotAuthorizedException", "Unable to verify secret hash for client abc"))).toMatch(/isn't set up/);
    expect(authErrorMessage(err("NotAuthorizedException", "User cannot be confirmed. Current status is CONFIRMED"), "confirm")).toMatch(/already confirmed/);
    expect(authErrorMessage(err("NotAuthorizedException", "Password attempts exceeded"))).toMatch(/Too many attempts/);
    expect(authErrorMessage(err("NotAuthorizedException", "something new"), "signUp")).toBe("Something went wrong. Please try again.");
    expect(authErrorMessage(err("NotAuthorizedException", "Incorrect username or password."), "changePassword")).toBe("Your current password is incorrect");
  });

  it("maps sign-up and code errors", () => {
    expect(authErrorMessage(err("UsernameExistsException"))).toBe("An account with this email already exists");
    expect(authErrorMessage(err("CodeMismatchException"))).toMatch(/code is incorrect/);
    expect(authErrorMessage(err("ExpiredCodeException"))).toMatch(/expired/);
    expect(authErrorMessage(err("InvalidPasswordException"))).toMatch(/requirements/);
    expect(authErrorMessage(err("LimitExceededException"))).toMatch(/Too many attempts/);
  });

  it("network errors, by name or by message", () => {
    expect(authErrorMessage(err("NetworkError"))).toMatch(/Can't connect/);
    expect(authErrorMessage(err("Error", "Network request failed"))).toMatch(/Can't connect/);
  });

  it("anything else gets a generic message and never echoes Cognito's text", () => {
    expect(authErrorMessage(err("InternalErrorException", "User dana@example.com does not exist"))).toBe("Something went wrong. Please try again.");
    expect(authErrorMessage(null)).toBe("Something went wrong. Please try again.");
    expect(authErrorMessage("boom")).toBe("Something went wrong. Please try again.");
  });
});

describe("authErrorMessage for a password reset", () => {
  it("an unknown email reads like a wrong code", () => {
    expect(authErrorMessage(err("UserNotFoundException"), "resetPassword")).toMatch(/code is incorrect/);
  });

  it("code and password errors", () => {
    expect(authErrorMessage(err("CodeMismatchException"), "resetPassword")).toMatch(/code is incorrect/);
    expect(authErrorMessage(err("ExpiredCodeException"), "resetPassword")).toMatch(/expired/);
    expect(authErrorMessage(err("InvalidPasswordException"), "resetPassword")).toMatch(/requirements/);
    expect(authErrorMessage(err("LimitExceededException"), "resetPassword")).toMatch(/Too many attempts/);
  });
});
