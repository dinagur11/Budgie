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
  awsRegion: required("AWS_REGION"),
  s3ReceiptsBucket: required("S3_BUCKET"),
  openaiApiKey: required("OPENAI_API_KEY"),
  openaiReceiptModel: required("OPENAI_RECEIPT_MODEL"),
  openaiAskModel: required("OPENAI_ASK_MODEL"),
};