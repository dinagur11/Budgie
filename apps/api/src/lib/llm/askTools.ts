import { Currency } from "../../../generated/prisma/client.js";

// The Ask AI tools as OpenAI function definitions. Strict mode: every property is required and nullable, so the model
// sends null for a filter it doesn't use. The dispatcher in services/askService.ts validates every argument again.

const FILTER_PROPERTIES = {
  from: { type: ["string", "null"], description: "First day to include, YYYY-MM-DD (inclusive)." },
  to: { type: ["string", "null"], description: "Last day to include, YYYY-MM-DD (inclusive)." },
  categoryId: { type: ["integer", "null"], description: "Only this category: an id from the category list." },
  paidById: { type: ["integer", "null"], description: "Only expenses this member paid: an id from the member list." },
  nameContains: {
    type: ["string", "null"],
    description: "Only expenses whose name contains this text (a store, business or item), case-insensitive.",
  },
  currency: { type: ["string", "null"], enum: [...Object.values(Currency), null], description: "Only this currency." },
} as const;

function tool(name: string, description: string, properties: Record<string, unknown>) {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: { type: "object", additionalProperties: false, properties, required: Object.keys(properties) },
  };
}

export const ASK_TOOLS = [
  tool(
    "totalSpending",
    "Total spent and number of expenses, per currency, optionally split by category, payer or expense name (top 20 groups plus an 'other' row). Use for 'how much did we spend on X', 'where do we spend the most', 'how many times did I buy X'.",
    { ...FILTER_PROPERTIES, groupBy: { type: ["string", "null"], enum: ["category", "payer", "name", "none", null], description: "How to split the total; null or none for no split." } },
  ),
  tool(
    "averageMonthlySpending",
    "Average spent per month, per currency. With from/to it averages over every month of that window (months without spending count as 0); without them, over the months that have matching spending. The result's basis says which.",
    FILTER_PROPERTIES,
  ),
  tool(
    "topExpenses",
    "The most expensive single expenses, per currency.",
    { ...FILTER_PROPERTIES, limit: { type: ["integer", "null"], description: "How many per currency, 1 to 25; null means 5." } },
  ),
  tool("topCategory", "Categories ranked by total spent, the top 5 per currency.", FILTER_PROPERTIES),
  tool("peakMonth", "The month with the highest total, and the runner-up, per currency.", FILTER_PROPERTIES),
  tool(
    "recurringCost",
    "What the active recurring expenses cost per month (approximate monthly equivalent), per currency, with each rule.",
    { paidById: FILTER_PROPERTIES.paidById },
  ),
  tool(
    "lastPurchase",
    "The most recent expense whose name contains the text, or found: false.",
    { ...FILTER_PROPERTIES, nameContains: { type: "string", description: "Text the expense name contains (a store, business or item), case-insensitive." } },
  ),
];
