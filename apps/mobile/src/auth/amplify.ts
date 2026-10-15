import { Amplify } from "aws-amplify";
import { config } from "../config";
import { FIXTURES } from "../fixtures/fixtures";

// Cognito only (no identity pool, no hosted UI). Sign-in uses Amplify's default SRP flow.
// The session is persisted by Amplify (AsyncStorage on React Native).
let configured = false;
export function configureAmplify() {
  if (configured || FIXTURES) return;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.cognitoUserPoolId,
        userPoolClientId: config.cognitoClientId,
        loginWith: { email: true },
        signUpVerificationMethod: "code",
      },
    },
  });
  configured = true;
}
