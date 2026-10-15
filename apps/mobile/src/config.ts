// Build-time configuration. Expo inlines EXPO_PUBLIC_* values only when they are read as
// process.env.EXPO_PUBLIC_NAME literally, so each one is read on its own line (no destructuring).
// The values come from apps/mobile/.env (names in .env.example); they end up in the app bundle, so they are not secrets.

// fixture mode (src/fixtures/fixtures.ts) talks to neither the API nor Cognito, so it needs none of the values
const fixtures = process.env.EXPO_PUBLIC_FIXTURES === "true";

function required(name: string, value: string | undefined): string {
  if (fixtures && (value === undefined || value.trim() === "")) return "fixtures";
  if (value === undefined || value.trim() === "")
    throw new Error(`Missing ${name}. Copy apps/mobile/.env.example to .env, fill it in and restart the dev server.`);
  return value.trim();
}

export const config = {
  // no trailing slash, so paths can be appended as "/households/..."
  apiUrl: required("EXPO_PUBLIC_API_URL", process.env.EXPO_PUBLIC_API_URL).replace(/\/+$/, ""),
  cognitoUserPoolId: required("EXPO_PUBLIC_COGNITO_USER_POOL_ID", process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID),
  cognitoClientId: required("EXPO_PUBLIC_COGNITO_CLIENT_ID", process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID),
  cognitoRegion: "eu-central-1",
} as const;
