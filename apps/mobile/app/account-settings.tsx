import { useRef, useState } from "react";
import { Alert, StyleSheet, Text, type TextInput } from "react-native";
import { router } from "expo-router";
import { AppHeader } from "../src/components/AppHeader";
import { Banner } from "../src/components/Banner";
import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { Screen } from "../src/components/Screen";
import { ErrorView, LoadingView } from "../src/components/StateViews";
import { TextField } from "../src/components/TextField";
import { useMe, usePremiumChange, useUpdateMe } from "../src/api/hooks";
import type { Me } from "../src/api/types";
import { errorMessage } from "../src/api/errors";
import { changePassword } from "../src/auth/auth";
import { authErrorMessage } from "../src/auth/errors";
import { useSession } from "../src/auth/session";
import { cancelPremiumMessage, JOIN_PREMIUM_ROUTE, premiumDateLabel } from "../src/lib/premium";
import { validateConfirmPassword, validateLoginPassword, validateName, validateNewPassword } from "../src/lib/validate";
import { colors, type as t } from "../src/theme";

// The user's own settings (opened from the households list's bar): change name (our API), premium (cancel at the end of
// the paid month, keep it, or join), change password (Cognito only, never through our API) and log out. Household settings stay in the household's Settings tab.
export default function AccountSettingsScreen() {
  const me = useMe();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <Screen header={<AppHeader onBack={back} backLabel="Back" />}>
      <Text style={styles.heading}>Settings</Text>
      {me.isError ? (
        <Card><ErrorView message={errorMessage(me.error)} onRetry={() => me.refetch()} /></Card>
      ) : !me.data ? (
        <LoadingView />
      ) : (
        <>
          <NameCard me={me.data} />
          <PremiumCard me={me.data} />
        </>
      )}
      <PasswordCard />
      <LogOut />
    </Screen>
  );
}

function NameCard({ me }: { me: Me }) {
  const update = useUpdateMe();
  const [name, setName] = useState(me.name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = name.trim() !== me.name;

  async function save() {
    const next = validateName(name);
    setError(next);
    setSaved(false);
    if (next || !dirty) return;
    try {
      const result = await update.mutateAsync(name.trim());
      setName(result.name);
      setSaved(true);
    } catch {
      // shown from update.error below
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Change name</Text>
      {update.isError && <Banner message={errorMessage(update.error)} />}
      {saved && !dirty && <Banner tone="success" message="Name saved" />}
      <TextField label="Name" value={name} onChangeText={setName} error={error} maxLength={100} autoComplete="name" textContentType="name" returnKeyType="done" onSubmitEditing={save} />
      <Text style={styles.hint}>This is how the members of your households see you.</Text>
      <Button label="Save name" onPress={save} loading={update.isPending} disabled={!dirty} />
    </Card>
  );
}

function PremiumCard({ me }: { me: Me }) {
  const change = usePremiumChange();

  function confirmCancel(renewsAt: string) {
    Alert.alert("Cancel membership?", cancelPremiumMessage(premiumDateLabel(renewsAt)), [
      { text: "Keep premium", style: "cancel" },
      { text: "Cancel membership", style: "destructive", onPress: () => change.mutate("cancel") },
    ]);
  }

  let text: string;
  let button: React.ReactNode;
  if (!me.isPremium) {
    text = "Get 10 receipt scans a day instead of 3, and ask questions about your spending with Ask AI.";
    button = <Button label="Join premium" icon="workspace-premium" onPress={() => router.push(JOIN_PREMIUM_ROUTE)} />;
  } else if (me.premiumEndsAt) {
    text = `Your membership is canceled and ends on ${premiumDateLabel(me.premiumEndsAt)}. Until then you keep every premium feature.`;
    button = <Button label="Keep premium" onPress={() => change.mutate("resume")} loading={change.isPending} />;
  } else {
    const renewsAt = me.premiumRenewsAt;
    text = renewsAt ? `Your membership renews monthly. Next renewal: ${premiumDateLabel(renewsAt)}.` : "Your membership renews monthly.";
    button = renewsAt && (
      <Button label="Cancel membership" variant="danger" onPress={() => confirmCancel(renewsAt)} loading={change.isPending} />
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Premium</Text>
      {change.isError && <Banner message={errorMessage(change.error)} />}
      <Text style={styles.text}>{text}</Text>
      {button}
    </Card>
  );
}

type PasswordErrors = { current?: string | null; next?: string | null; confirm?: string | null };

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [banner, setBanner] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const nextRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  async function save() {
    const found: PasswordErrors = {
      current: validateLoginPassword(current),
      next: validateNewPassword(next),
      confirm: validateConfirmPassword(next, confirm),
    };
    setErrors(found);
    setBanner(null);
    if (Object.values(found).some(Boolean)) return;
    setLoading(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setBanner({ tone: "success", message: "Password changed" });
    } catch (e) {
      setBanner({ tone: "error", message: authErrorMessage(e, "changePassword") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Change password</Text>
      {banner && <Banner tone={banner.tone} message={banner.message} />}
      <TextField
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        error={errors.current}
        password
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="next"
        onSubmitEditing={() => nextRef.current?.focus()}
      />
      <TextField
        ref={nextRef}
        label="New password"
        value={next}
        onChangeText={setNext}
        error={errors.next}
        password
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
      />
      {!errors.next && <Text style={styles.hint}>At least 8 characters, with upper and lower case letters, a number and a symbol.</Text>}
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
        onSubmitEditing={save}
      />
      <Button label="Change password" onPress={save} loading={loading} />
    </Card>
  );
}

function LogOut() {
  const { signOut } = useSession();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      label="Log out"
      variant="danger"
      icon="logout"
      loading={loading}
      onPress={async () => {
        setLoading(true);
        // the session gate sends the user to the welcome screen
        await signOut().finally(() => setLoading(false));
      }}
    />
  );
}

const styles = StyleSheet.create({
  heading: { ...t.headlineMd, color: colors.onSurface, marginTop: 8, marginBottom: 2 },
  card: { padding: 16, gap: 14 },
  title: { ...t.headlineSm, color: colors.onSurface },
  text: { ...t.bodyMd, color: colors.onSurfaceVariant },
  hint: { ...t.bodySm, color: colors.onSurfaceVariant, marginTop: -8 },
});
