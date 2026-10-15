import { useLocalSearchParams } from "expo-router";
import { RuleScreen } from "../src/expenses/RuleForm";

// PATCH /households/:id/rules/:ruleId, opened from the household screen's recurring expenses (?ruleId=)
export default function EditRuleScreen() {
  const { ruleId } = useLocalSearchParams<{ ruleId?: string }>();
  const id = typeof ruleId === "string" && /^[1-9]\d{0,9}$/.test(ruleId) ? Number(ruleId) : null;
  return <RuleScreen ruleId={id} />;
}
