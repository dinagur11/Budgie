import { AppHeader, useBackToHouseholds } from "../../src/components/AppHeader";
import { HouseholdSwitcher } from "../../src/components/HouseholdSwitcher";
import { Placeholder } from "../../src/components/Placeholder";
import { Screen } from "../../src/components/Screen";
import { useHouseholdSelection } from "../../src/household/HouseholdContext";

// Questions about the household's spending in plain English (premium). Not built yet: a coming-soon placeholder.
export default function AskAiScreen() {
  const back = useBackToHouseholds();
  const { selectedId } = useHouseholdSelection();
  return (
    <Screen inTabs header={<AppHeader onBack={back} center={selectedId !== null ? <HouseholdSwitcher /> : undefined} />}>
      <Placeholder icon="auto-awesome" title="Coming soon" text="Ask questions about your household's spending in plain English." />
    </Screen>
  );
}
