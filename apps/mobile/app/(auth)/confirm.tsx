import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "../../src/components/Screen";
import { Card } from "../../src/components/Card";
import { TextField } from "../../src/components/TextField";
import { Button } from "../../src/components/Button";
import { Banner } from "../../src/components/Banner";
import { AuthTop } from "../../src/components/AuthTop";
import { authStyles as styles } from "../../src/components/authStyles";
import { confirmSignUp, resendCode } from "../../src/auth/auth";
import { authErrorMessage } from "../../src/auth/errors";
import { useSession } from "../../src/auth/session";
import { validateCode } from "../../src/lib/validate";

const RESEND_COOLDOWN = 30; // seconds

// The 6-digit email code. After registering in this app session Amplify signs in automatically;
// otherwise (the code came after a login attempt or an app restart) the user goes back to log in.
export default function ConfirmScreen() {
  const { email = "" } = useLocalSearchParams<{ email?: string }>();
  const { refresh } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function submit() {
    const codeError = validateCode(code);
    setError(codeError);
    setBanner(null);
    if (codeError) return;
    setLoading(true);
    try {
      const signedIn = await confirmSignUp(email, code);
      if (signedIn) await refresh();
      else router.replace({ pathname: "/login", params: { confirmed: "1" } });
    } catch (e) {
      setBanner({ tone: "error", message: authErrorMessage(e, "confirm") });
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setResending(true);
    setBanner(null);
    try {
      await resendCode(email);
      setBanner({ tone: "success", message: "We sent a new code." });
      setCooldown(RESEND_COOLDOWN);
    } catch (e) {
      setBanner({ tone: "error", message: authErrorMessage(e, "confirm") });
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen top={<AuthTop title="Check your email" subtitle={`We sent a 6-digit code to ${email || "your email"}.`} />}>
      <Card style={styles.card}>
        {banner && <Banner tone={banner.tone} message={banner.message} />}
        <TextField
          label="Confirmation code"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
          error={error}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Button label="Confirm" onPress={submit} loading={loading} />
        <Button
          label={cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          variant="text"
          onPress={resend}
          loading={resending}
          disabled={cooldown > 0 || !email}
        />
      </Card>
      <View style={styles.footer}>
        <Button label="Back to log in" variant="text" onPress={() => router.replace("/login")} />
      </View>
    </Screen>
  );
}
