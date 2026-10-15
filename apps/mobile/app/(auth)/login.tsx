import { useRef, useState } from "react";
import { Text, View, type TextInput } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "../../src/components/Screen";
import { Card } from "../../src/components/Card";
import { TextField } from "../../src/components/TextField";
import { Button } from "../../src/components/Button";
import { Banner } from "../../src/components/Banner";
import { AuthTop } from "../../src/components/AuthTop";
import { signIn } from "../../src/auth/auth";
import { authErrorMessage } from "../../src/auth/errors";
import { useSession } from "../../src/auth/session";
import { validateEmail, validateLoginPassword } from "../../src/lib/validate";
import { authStyles as styles } from "../../src/components/authStyles";

export default function LoginScreen() {
  // ?confirmed=1 after confirming an email without an automatic sign-in
  const { confirmed } = useLocalSearchParams<{ confirmed?: string }>();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    const next = { email: validateEmail(email), password: validateLoginPassword(password) };
    setErrors(next);
    setBanner(null);
    if (next.email || next.password) return;
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (result.kind === "done") await refresh(); // the session gate then shows the home screen
      else if (result.kind === "confirm") router.push({ pathname: "/confirm", params: { email: email.trim() } });
      else setBanner("This account needs a sign-in step the app doesn't support yet.");
    } catch (e) {
      setBanner(authErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen top={<AuthTop title="Welcome back" subtitle="Log in to see your households and what they've spent." />}>
      <Card style={styles.card}>
        {confirmed === "1" && !banner && <Banner tone="success" message="Your email is confirmed. Log in to continue." />}
        {banner && <Banner message={banner} />}
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          password
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Button label="Log in" onPress={submit} loading={loading} />
      </Card>
      <View style={styles.footer}>
        <Text style={styles.footerText}>New to Budgie?</Text>
        <Button label="Create an account" variant="text" onPress={() => router.replace("/register")} />
      </View>
    </Screen>
  );
}
