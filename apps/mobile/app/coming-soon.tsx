import { Stack, router, useLocalSearchParams } from "expo-router";
import { Button } from "../src/components/Button";
import { Placeholder } from "../src/components/Placeholder";
import { Screen } from "../src/components/Screen";

// placeholder for screens that aren't built yet (the "+" menu's "Photograph Receipt", the profile); ?title=&text=
export default function ComingSoonScreen() {
  const { title = "Coming soon", text = "This screen is coming soon." } = useLocalSearchParams<{ title?: string; text?: string }>();
  return (
    <Screen centered>
      <Stack.Screen options={{ title }} />
      <Placeholder icon="construction" title={title} text={text} />
      <Button label="Back" variant="tonal" onPress={() => router.back()} />
    </Screen>
  );
}
