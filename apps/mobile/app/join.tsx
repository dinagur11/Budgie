import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Screen } from "../src/components/Screen";
import { Card } from "../src/components/Card";
import { Button } from "../src/components/Button";
import { Banner } from "../src/components/Banner";
import { Pill } from "../src/components/Pill";
import { Icon, type IconName } from "../src/components/Icon";
import { LoadingView } from "../src/components/StateViews";
import { useAcceptInvite, useInvitePreview } from "../src/api/hooks";
import { useHouseholdSelection } from "../src/household/HouseholdContext";
import { takePendingInvite } from "../src/invite/pendingInvite";
import { inviteErrorMessage, isFinalInviteError } from "../src/lib/invite";
import { colors, fonts, type as t } from "../src/theme";

// Opened by an invite link (app/+native-intent.tsx keeps the token aside). Shows the household's name and active
// members (POST /households/join/preview), then Accept (POST /households/join) or Cancel. Nothing changes until Accept.
export default function JoinScreen() {
  // taken once, so the root layout doesn't open this screen again; afterwards the token lives only here
  const [token] = useState(takePendingInvite);
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite();
  const { select } = useHouseholdSelection();

  // opened from a link on a cold start there is nothing to go back to
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  async function join() {
    if (token === null) return;
    try {
      const household = await accept.mutateAsync(token);
      select(household.id);
      router.replace({ pathname: "/household/[id]", params: { id: String(household.id) } });
    } catch {
      // shown from accept.error below
    }
  }

  let body: ReactNode;
  if (token === null) {
    body = <Message icon="link-off" text="This invite link isn't valid. Ask for a new one." />;
  } else if (preview.isError) {
    body = (
      <>
        <Message icon={isFinalInviteError(preview.error) ? "link-off" : "cloud-off"} text={inviteErrorMessage(preview.error)} />
        {!isFinalInviteError(preview.error) && <Button label="Try again" icon="refresh" onPress={() => void preview.refetch()} />}
      </>
    );
  } else if (!preview.data) {
    body = <LoadingView label="Loading invite…" />;
  } else {
    const { householdName, members } = preview.data;
    const finalError = accept.isError && isFinalInviteError(accept.error);
    body = (
      <>
        <View style={styles.household}>
          <Text style={styles.label}>You're invited to join</Text>
          <Text style={styles.name}>{householdName}</Text>
          <Text style={styles.count}>{members.length === 1 ? "1 member" : `${members.length} members`}</Text>
        </View>
        <View>
          {members.map((m, i) => (
            <View key={i} style={[styles.row, i > 0 && styles.separator]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{m.name.trim().charAt(0).toUpperCase() || "?"}</Text>
              </View>
              <Text style={styles.member} numberOfLines={1}>{m.name}</Text>
              <Pill label={m.role === "OWNER" ? "Owner" : "Member"} tone={m.role === "OWNER" ? "secondary" : "neutral"} />
            </View>
          ))}
        </View>
        <Text style={styles.hint}>Members of a household see all its expenses, and everyone can add their own.</Text>
        {accept.isError && <Banner message={inviteErrorMessage(accept.error)} />}
        {!finalError && <Button label="Accept invite" icon="check" onPress={() => void join()} loading={accept.isPending} />}
      </>
    );
  }

  const done = token === null || (preview.isError && isFinalInviteError(preview.error)) || (accept.isError && isFinalInviteError(accept.error));
  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.title}>Household invite</Text>
        {body}
        <Button label={done ? "Close" : "Cancel"} variant="text" onPress={close} disabled={accept.isPending} />
      </Card>
    </Screen>
  );
}

function Message({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.message} accessibilityLiveRegion="polite">
      <Icon name={icon} size={28} color={colors.outline} />
      <Text style={styles.messageText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  title: { ...t.headlineMd, color: colors.onSurface },
  household: { alignItems: "center", gap: 2, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.secondaryFixed },
  label: { ...t.bodySm, color: colors.onSurfaceVariant },
  name: { ...t.headlineSm, color: colors.secondary, textAlign: "center", paddingHorizontal: 12 },
  count: { ...t.bodySm, color: colors.onSurfaceVariant },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 6 },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.secondaryFixed, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.jakarta700, fontSize: 15, color: colors.secondary },
  member: { ...t.labelLg, color: colors.onSurface, flex: 1 },
  hint: { ...t.bodySm, color: colors.onSurfaceVariant, textAlign: "center" },
  message: { alignItems: "center", gap: 10, paddingVertical: 12 },
  messageText: { ...t.bodyMd, color: colors.onSurfaceVariant, textAlign: "center" },
});
