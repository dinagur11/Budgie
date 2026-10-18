import { useEffect, useState } from "react";
import { Stack, router, usePathname, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from "@expo-google-fonts/plus-jakarta-sans";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { configureAmplify } from "../src/auth/amplify";
import { SessionProvider, useSession } from "../src/auth/session";
import { HouseholdProvider } from "../src/household/HouseholdContext";
import { usePendingInvite } from "../src/invite/pendingInvite";
import { ApiError } from "../src/api/errors";
import { colors } from "../src/theme";

// before anything renders: Amplify must be configured before the session check, and the splash
// stays up until the fonts are loaded and we know whether someone is signed in
configureAmplify();
void SplashScreen.preventAutoHideAsync();

// client errors (4xx) won't succeed on a retry; network and server errors get two more tries
function retry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry, staleTime: 30_000 } } }));
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
  });

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          {/* if a font fails to load, carry on with the system font rather than hang on the splash */}
          <RootNavigator fontsReady={fontsLoaded || !!fontError} />
        </SessionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

// (auth) when signed out, (tabs) and the other signed-in screens when signed in. Changing the session status
// (sign-in, sign-up confirmation, sign-out, a 401) redirects by itself.
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useSession();
  const ready = fontsReady && status !== "loading";

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  const signedIn = status === "signedIn";
  return (
    <HouseholdProvider enabled={signedIn}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="create-household" options={{ presentation: "modal" }} />
          <Stack.Screen name="create-expense" options={{ presentation: "modal" }} />
          <Stack.Screen name="scan-receipt" options={{ presentation: "modal" }} />
          <Stack.Screen name="edit-expense" options={{ presentation: "modal" }} />
          <Stack.Screen name="create-rule" options={{ presentation: "modal" }} />
          <Stack.Screen name="edit-rule" options={{ presentation: "modal" }} />
          <Stack.Screen name="create-category" options={{ presentation: "modal" }} />
          <Stack.Screen name="coming-soon" />
          <Stack.Screen name="account-settings" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="join" options={{ presentation: "modal" }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
      {signedIn && <OpenPendingInvite />}
    </HouseholdProvider>
  );
}

// Opens the join screen for an invite link (app/+native-intent.tsx). Signed out, the token waits
// (src/invite/pendingInvite.ts) until someone signs in, or registers and confirms. The join screen takes the token,
// so this opens it once.
function OpenPendingInvite() {
  const token = usePendingInvite();
  const pathname = usePathname();
  const navigationReady = !!useRootNavigationState()?.key;

  useEffect(() => {
    if (token !== null && navigationReady && pathname !== "/join") router.push("/join");
  }, [token, navigationReady, pathname]);
  return null;
}
