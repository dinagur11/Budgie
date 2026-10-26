import OpenAI from "openai";
import { config } from "../../config.js";

// One model call of the Ask AI tool-calling loop (services/askService.ts runs the loop).

export type FunctionCall = { callId: string; name: string; arguments: string };

export type AskModelTurn = {
  // every output item, to pass back as input on the next call (store is false, so OpenAI keeps no conversation)
  output: unknown[];
  functionCalls: FunctionCall[];
  text: string;
  usage: { inputTokens: number; outputTokens: number };
};

export type AskModelRequest = {
  instructions: string;
  input: unknown[];
  tools: unknown[];
  // false on the last round: the model must answer instead of calling another tool
  allowTools: boolean;
};

const client = new OpenAI({ apiKey: config.openaiApiKey });

const REQUEST_TIMEOUT_MS = 30_000;
// Generous on purpose: a reasoning model's thinking tokens count against this limit.
const MAX_OUTPUT_TOKENS = 2000;

export async function callAskModel(req: AskModelRequest): Promise<AskModelTurn> {
  const response = await client.responses.create(
    {
      model: config.openaiAskModel,
      instructions: req.instructions,
      input: req.input as OpenAI.Responses.ResponseInput,
      tools: req.tools as OpenAI.Responses.Tool[],
      tool_choice: req.allowTools ? "auto" : "none",
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false, // don't keep the questions or the household's numbers on OpenAI's side
      // with store false, reasoning items can only be passed back to the next call with their encrypted content
      include: ["reasoning.encrypted_content"],
    },
    { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
  );

  if (response.status !== "completed") {
    throw new Error(`Ask ended with status ${response.status}`);
  }
  const functionCalls: FunctionCall[] = [];
  for (const item of response.output) {
    if (item.type === "function_call") functionCalls.push({ callId: item.call_id, name: item.name, arguments: item.arguments });
  }
  return {
    output: response.output,
    functionCalls,
    text: response.output_text,
    usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
  };
}
