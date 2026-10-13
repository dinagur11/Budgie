import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required("DATABASE_URL"),
  cognitoUserPoolId: required("COGNITO_USER_POOL_ID"),
  cognitoClientId: required("COGNITO_CLIENT_ID"),
  // not used yet; make it required() when the OpenAI code is added
  openaiApiKey: process.env.OPENAI_API_KEY,
};