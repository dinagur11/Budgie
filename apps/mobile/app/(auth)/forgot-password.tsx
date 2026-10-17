import { useEffect, useRef, useState } from "react";
import { Text, View, type TextInput } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "../../src/components/Screen";
import { Card } from "../../src/components/Card";
import { TextField } from "../../src/components/TextField";
import { Button } from "../../src/components/Button";
import { Banner } from "../../src/components/Banner";
import { AuthTop } from "../../src/components/AuthTop";
import { authStyles as styles } from "../../src/components/authStyles";
import { confirmPasswordReset, requestPasswordReset } from "../../src/auth/auth";
import { authErrorMessage } from "../../src/auth/errors";
import { validateCode, validateConfirmPassword, validateEmail, validateNewPassword } from "../../src/lib/validate";

const RESEND_COOLDOWN = 30; // seconds

type Errors = { code?: string | null; password?: string | null; confirm?: string | null };

// Two steps on one screen: the email (Cognito sends a code), then the code and a new password.
// Cognito doesn't sign in after a reset, so the user goes back to log in.
export default function ForgotPasswordScreen() {
  // the login screen passes what was typed there
  const params = useLocalSearchParams<{ email?: string }>();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState(params.email ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // an unknown email still moves on to the code step, so the screen never reveals whether an account exists
  async function sendCode(): Promise<boolean> {
    try {
      await requestPasswordReset(email);
      return true;
    } catch (e) {
      if ((e as { name?: unknown } | null)?.name === "UserNotFoundException") return true;
      setBanner({ tone: "error", message: authErrorMessage(e, "resetPassword") });
      return false;
    }
  }

  async function submitEmail() {
    const error = validateEmail(email);
    setEmailError(error);
    setBanner(null);
    if (error) return;
    setLoading(true);
    const sent = await sendCode();
    setLoading(false);
    if (!sent) return;
    setStep("reset");
    setCooldown(RESEND_COOLDOWN);
  }

  async function resend() {
    setResending(true);
    setBanner(null);
    if (await sendCode()) {
      setBanner({ tone: "success", message: "We sent a new code." });
      setCooldown(RESEND_COOLDOWN);
    }
    setResending(false);
  }

  async function submitReset() {
    const next: Errors = {
      code: validateCode(code),
      password: validateNewPassword(password),
      confirm: validateConfirmPassword(password, confirm),
    };
    setErrors(next);
    setBanner(null);
    if (Object.values(next).some(Boolean)) return;
    setLoading(true);
    try {
      await confirmPasswordReset(email, code, password);
      router.replace({ pathname: "/login", params: { reset: "1" } });
    } catch (e) {
      setBanner({ tone: "error", message: authErrorMessage(e, "resetPassword") });
    } finally {
      setLoading(false);
    }
  }

  if (step === "email") {
    return (
      <Screen top={<AuthTop title="Forgot your password?" subtitle="Enter your email and we'll send you a code to set a new one." />}>
        <Card style={styles.card}>
          {banner && <Banner tone={banner.tone} message={banner.message} />}
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            error={emailError}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={submitEmail}
          />
          <Button label="Send code" onPress={submitEmail} loading={loading} />
        </Card>
        <View style={styles.footer}>
          <Button label="Back to log in" variant="text" onPress={() => router.replace("/login")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen top={<AuthTop title="Set a new password" subtitle={`If ${email.trim()} has an account, we sent it a 6-digit code.`} />}>
      <Card style={styles.card}>
        {banner && <Banner tone={banner.tone} message={banner.message} />}
        <TextField
          label="Code"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
          error={errors.code}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <TextField
          ref={passwordRef}
          label="New password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />
        {!errors.password && <Text style={styles.hint}>At least 8 characters, with upper and lower case letters, a number and a symbol.</Text>}
        <TextField
          ref={confirmRef}
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          error={errors.confirm}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submitReset}
        />
        <Button label="Change password" onPress={submitReset} loading={loading} />
        <Button
          label={cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          variant="text"
          onPress={resend}
          loading={resending}
          disabled={cooldown > 0}
        />
        <Button
          label="Use a different email"
          variant="text"
          onPress={() => {
            setStep("email");
            setBanner(null);
            setErrors({});
            setCode("");
          }}
        />
      </Card>
      <View style={styles.footer}>
        <Button label="Back to log in" variant="text" onPress={() => router.replace("/login")} />
      </View>
    </Screen>
  );
}
