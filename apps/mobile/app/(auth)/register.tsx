import { useRef, useState } from "react";
import { Text, View, type TextInput } from "react-native";
import { router } from "expo-router";
import { Screen } from "../../src/components/Screen";
import { Card } from "../../src/components/Card";
import { TextField } from "../../src/components/TextField";
import { Button } from "../../src/components/Button";
import { Banner } from "../../src/components/Banner";
import { AuthTop } from "../../src/components/AuthTop";
import { authStyles as styles } from "../../src/components/authStyles";
import { signUp } from "../../src/auth/auth";
import { authErrorMessage } from "../../src/auth/errors";
import { validateConfirmPassword, validateEmail, validateName, validateNewPassword } from "../../src/lib/validate";

type Errors = { name?: string | null; email?: string | null; password?: string | null; confirm?: string | null };

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  async function submit() {
    const next: Errors = {
      name: validateName(name),
      email: validateEmail(email),
      password: validateNewPassword(password),
      confirm: validateConfirmPassword(password, confirm),
    };
    setErrors(next);
    setBanner(null);
    if (Object.values(next).some(Boolean)) return;
    setLoading(true);
    try {
      const { needsConfirmation } = await signUp(name, email, password);
      // the pool requires a code; if it ever doesn't, the user logs in directly
      if (needsConfirmation) router.push({ pathname: "/confirm", params: { email: email.trim() } });
      else router.replace({ pathname: "/login", params: { confirmed: "1" } });
    } catch (e) {
      setBanner(authErrorMessage(e, "signUp"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen top={<AuthTop title="Create your account" subtitle="Start tracking expenses together with your household." />}>
      <Card style={styles.card}>
        {banner && <Banner message={banner} />}
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          error={errors.name}
          autoComplete="name"
          textContentType="name"
          maxLength={100}
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
        />
        <TextField
          ref={emailRef}
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
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />
        {!errors.password && <Text style={styles.hint}>At least 8 characters, with upper and lower case letters, a number and a symbol.</Text>}
        <TextField
          ref={confirmRef}
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          error={errors.confirm}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Button label="Create account" onPress={submit} loading={loading} />
      </Card>
      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account?</Text>
        <Button label="Log in" variant="text" onPress={() => router.replace("/login")} />
      </View>
    </Screen>
  );
}
