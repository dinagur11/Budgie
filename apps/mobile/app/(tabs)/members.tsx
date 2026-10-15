import { useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { AppHeader } from "../../src/components/AppHeader";
import { Banner } from "../../src/components/Banner";
import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { HouseholdSwitcher } from "../../src/components/HouseholdSwitcher";
import { Icon } from "../../src/components/Icon";
import { Pill } from "../../src/components/Pill";
import { Placeholder } from "../../src/components/Placeholder";
import { Screen } from "../../src/components/Screen";
import { ErrorView, LoadingView } from "../../src/components/StateViews";
import { useHouseholdSelection } from "../../src/household/HouseholdContext";
import { useCreateInvite, useHousehold, useMe, useMembers, useRemoveMember } from "../../src/api/hooks";
import type { Household, Member } from "../../src/api/types";
import { ApiError, errorMessage } from "../../src/api/errors";
import { dateInTimeZone, longDateLabel } from "../../src/lib/dates";
import { inviteLink, inviteMessage } from "../../src/lib/invite";
import { colors, fonts, MIN_TOUCH, type as t } from "../../src/theme";

// The selected household's active members (the caller included, marked "You"), when each joined and their role.
// An owner can remove the others and create invite links.
export default function MembersScreen() {
  const { selectedId } = useHouseholdSelection();
  const household = useHousehold(selectedId);
  const members = useMembers(selectedId);
  const me = useMe();
  const header = <AppHeader center={<HouseholdSwitcher />} />;

  if (selectedId === null)
    return (
      <Screen inTabs header={header}>
        <Placeholder icon="diversity-1" title="No household yet" text="Create a household to see its members here." />
      </Screen>
    );

  const queries = [household, members, me];
  const failed = queries.find((q) => q.isError);
  const refresh = () => queries.forEach((q) => void q.refetch());
  if (failed)
    return (
      <Screen inTabs header={header}>
        <Card><ErrorView message={errorMessage(failed.error)} onRetry={refresh} /></Card>
      </Screen>
    );
  if (!household.data || !members.data || !me.data)
    return <Screen inTabs header={header}><LoadingView /></Screen>;

  // the list includes former members (other screens use it to name departed payers); this screen shows active ones only
  const active = members.data.filter((m) => m.isActive);
  return (
    <Screen inTabs header={header} refreshing={members.isRefetching} onRefresh={refresh}>
      <MembersCard household={household.data} members={active} myId={me.data.id} />
      {household.data.role === "OWNER" ? (
        <InviteButton household={household.data} />
      ) : (
        <Text style={styles.hint}>Only an owner can invite people to this household.</Text>
      )}
    </Screen>
  );
}

function MembersCard({ household, members, myId }: { household: Household; members: Member[]; myId: number }) {
  const remove = useRemoveMember(household.id);
  const isOwner = household.role === "OWNER";

  function confirmRemove(member: Member) {
    Alert.alert(
      `Remove ${member.name}?`,
      `${member.name} will lose access to ${household.name}. Their expenses stay. You can invite them again later.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => remove.mutate(member.userId) },
      ],
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Members</Text>
      <Text style={styles.subtitle}>{members.length === 1 ? "1 person" : `${members.length} people`} in {household.name}</Text>
      {remove.isError && <Banner message={errorMessage(remove.error)} />}
      <View>
        {members.map((m, i) => {
          const isMe = m.userId === myId;
          return (
            <View key={m.userId} style={[styles.row, i > 0 && styles.separator]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{m.name.trim().charAt(0).toUpperCase() || "?"}</Text>
              </View>
              <View style={styles.info}>
                <View style={styles.nameLine}>
                  <Text style={styles.name} numberOfLines={1}>{m.name}</Text>
                  {isMe && <Pill label="You" />}
                </View>
                {/* the join date in the household's time zone, like every other date in the app */}
                <Text style={styles.joined}>Joined {longDateLabel(dateInTimeZone(m.joinedAt, household.timeZone))}</Text>
              </View>
              {/* fixed-width columns, so every row's role badge lines up whether or not it has a remove button */}
              <View style={styles.roleColumn}>
                <Pill label={m.role === "OWNER" ? "Owner" : "Member"} tone={m.role === "OWNER" ? "secondary" : "neutral"} />
              </View>
              {isOwner && (
                <View style={styles.removeColumn}>
                  {!isMe && (
                    <Pressable
                      onPress={() => confirmRemove(m)}
                      disabled={remove.isPending}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${m.name}`}
                      style={({ pressed }) => [styles.remove, pressed && { backgroundColor: colors.errorContainer }]}
                    >
                      <Icon name="delete-outline" size={22} color={colors.error} />
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

// POST /households/:id/invites, then the share sheet with the link; the raw token is never kept or logged
function InviteButton({ household }: { household: Household }) {
  const create = useCreateInvite(household.id);
  const [shareError, setShareError] = useState(false);

  async function invite() {
    setShareError(false);
    try {
      const { token, expiresAt } = await create.mutateAsync();
      const expires = longDateLabel(dateInTimeZone(expiresAt, household.timeZone));
      await Share.share({ message: inviteMessage(household.name, inviteLink(token), expires) });
    } catch (e) {
      // an API error is shown from create.error; anything else came from the share sheet
      if (!(e instanceof ApiError)) setShareError(true);
    }
  }

  return (
    <View style={styles.invite}>
      {create.isError && <Banner message={errorMessage(create.error)} />}
      {shareError && <Banner message="Couldn't open the share sheet. Please try again." />}
      <Button label="Create invite" icon="person-add" onPress={invite} loading={create.isPending} />
      <Text style={styles.hint}>Creates a link you can send. It works once and expires after 7 days.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  title: { ...t.headlineSm, color: colors.onSurface },
  subtitle: { ...t.bodySm, color: colors.onSurfaceVariant, marginTop: -8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingVertical: 8 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.secondaryFixed, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.jakarta700, fontSize: 16, color: colors.secondary },
  info: { flex: 1, gap: 2 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { ...t.labelLg, color: colors.onSurface, flexShrink: 1 },
  joined: { ...t.bodySm, color: colors.onSurfaceVariant },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant },
  roleColumn: { width: 64, alignItems: "center" },
  removeColumn: { width: MIN_TOUCH, alignItems: "center" },
  remove: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: "center", justifyContent: "center" },
  invite: { gap: 8, marginTop: 6 },
  hint: { ...t.bodySm, color: colors.onSurfaceVariant, textAlign: "center" },
});
