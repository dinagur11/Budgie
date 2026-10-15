import * as Amplify from "aws-amplify/auth";

// The email is the Cognito username. Results tell the screen where to go next.
export type SignInResult = { kind: "done" } | { kind: "confirm" } | { kind: "unsupported" };

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { nextStep } = await Amplify.signIn({ username: email.trim(), password });
  if (nextStep.signInStep === "DONE") return { kind: "done" };
  // the account exists but its email was never confirmed (Cognito checks the password first)
  if (nextStep.signInStep === "CONFIRM_SIGN_UP") {
    await Amplify.resendSignUpCode({ username: email.trim() });
    return { kind: "confirm" };
  }
  // MFA, a forced new password and so on are not supported yet
  await Amplify.signOut().catch(() => undefined);
  return { kind: "unsupported" };
}

// sends the name attribute (the backend takes User.name from the token's name claim) and the email
export async function signUp(name: string, email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  const { nextStep } = await Amplify.signUp({
    username: email.trim(),
    password,
    options: { userAttributes: { email: email.trim(), name: name.trim() }, autoSignIn: true },
  });
  return { needsConfirmation: nextStep.signUpStep === "CONFIRM_SIGN_UP" };
}

// returns true when the user is now signed in (auto sign-in after registering in this app session)
export async function confirmSignUp(email: string, code: string): Promise<boolean> {
  const { nextStep } = await Amplify.confirmSignUp({ username: email.trim(), confirmationCode: code.trim() });
  if (nextStep.signUpStep !== "COMPLETE_AUTO_SIGN_IN") return false;
  try {
    const result = await Amplify.autoSignIn();
    return result.nextStep.signInStep === "DONE";
  } catch {
    return false;
  }
}

export async function resendCode(email: string) {
  await Amplify.resendSignUpCode({ username: email.trim() });
}

export async function signOut() {
  await Amplify.signOut();
}

// Cognito checks the current password; the new one must meet the pool's policy
export async function changePassword(oldPassword: string, newPassword: string) {
  await Amplify.updatePassword({ oldPassword, newPassword });
}
