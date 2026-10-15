// Cognito / Amplify errors -> messages for the user. Kept free of React Native imports so it can be unit tested.

const GENERIC = "Something went wrong. Please try again.";

// sign-in must never reveal whether the email exists: unknown user and wrong password read the same
const BY_NAME: Record<string, string> = {
  NotAuthorizedException: "Incorrect email or password",
  UserNotFoundException: "Incorrect email or password",
  UsernameExistsException: "An account with this email already exists",
  AliasExistsException: "An account with this email already exists",
  CodeMismatchException: "That code is incorrect. Check the email and try again.",
  ExpiredCodeException: "That code has expired. Tap \"Resend code\" to get a new one.",
  InvalidPasswordException: "That password doesn't meet the requirements",
  LimitExceededException: "Too many attempts. Please wait a few minutes and try again.",
  TooManyRequestsException: "Too many attempts. Please wait a few minutes and try again.",
  TooManyFailedAttemptsException: "Too many attempts. Please wait a few minutes and try again.",
  CodeDeliveryFailureException: "We couldn't send the code. Please try again.",
  InvalidParameterException: "Please check your details and try again",
  NetworkError: "Can't connect. Check your internet connection and try again.",
};

// Cognito returns NotAuthorizedException for several unrelated problems; only on sign-in does it mean a wrong password
export type AuthAction = "signIn" | "signUp" | "confirm" | "changePassword";

const SIGNUP_DISABLED = "New accounts can't be created right now. Please try again later.";
const CLIENT_MISCONFIGURED = "The app isn't set up correctly. Please try again later.";
const ALREADY_CONFIRMED = "This account is already confirmed. Log in instead.";

function notAuthorizedMessage(message: string, action: AuthAction): string {
  // these come from the user pool or app client configuration, whatever the action
  if (/sign ?up is not permitted/i.test(message)) return SIGNUP_DISABLED;
  if (/secret hash/i.test(message)) return CLIENT_MISCONFIGURED;
  if (/attempts exceeded/i.test(message)) return BY_NAME.TooManyFailedAttemptsException;
  if (action === "signIn") return BY_NAME.NotAuthorizedException;
  if (action === "changePassword") return "Your current password is incorrect";
  if (action === "confirm" && /current status is confirmed/i.test(message)) return ALREADY_CONFIRMED;
  return GENERIC;
}

export function authErrorMessage(error: unknown, action: AuthAction = "signIn"): string {
  const e = error as { name?: unknown; message?: unknown } | null;
  const name = typeof e?.name === "string" ? e.name : "";
  const message = typeof e?.message === "string" ? e.message : "";
  // the raw Cognito error helps while developing; it never holds a token or a password
  if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[auth] ${action} failed: ${name} ${message}`);
  if (name === "NotAuthorizedException") return notAuthorizedMessage(message, action);
  if (name in BY_NAME) return BY_NAME[name];
  if (/network/i.test(message)) return BY_NAME.NetworkError;
  return GENERIC;
}
