import { AppHeader } from "../../src/components/AppHeader";
import { HouseholdSwitcher } from "../../src/components/HouseholdSwitcher";
import { Placeholder } from "../../src/components/Placeholder";
import { Screen } from "../../src/components/Screen";

export default function CalendarScreen() {
  return (
    <Screen inTabs header={<AppHeader center={<HouseholdSwitcher />} />}>
      <Placeholder icon="calendar-month" title="Calendar" text="The full month calendar with real and upcoming expenses is coming soon." />
    </Screen>
  );
}
