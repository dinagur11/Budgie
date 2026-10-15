import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMe } from "../api/hooks";
import { useSession } from "../auth/session";
import { colors, MIN_TOUCH, radii, shadows, type as t } from "../theme";
import { Icon, type IconName } from "./Icon";

// The account icon in the header and its drop-down: who is signed in (tap for the profile), and log out.
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const me = useMe();
  const { signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  async function logOut() {
    setSigningOut(true);
    // the session gate sends the user to the welcome screen; the modal goes away with this screen
    await signOut().finally(() => {
      setSigningOut(false);
      setOpen(false);
    });
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        accessibilityState={{ expanded: open }}
        hitSlop={(MIN_TOUCH - 36) / 2}
        style={({ pressed }) => [styles.avatarRing, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.avatar}><Icon name="person" size={16} color={colors.accent} /></View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close account menu" />
        {/* right under the header (56dp row below the status bar) */}
        <View style={[styles.menu, { top: insets.top + 52 }]}>
          {/* the name opens the profile (what the user paid across households) */}
          <Pressable
            onPress={() => { setOpen(false); router.push("/profile"); }}
            accessibilityRole="button"
            accessibilityLabel="Your profile"
            style={({ pressed }) => [styles.who, pressed && { backgroundColor: colors.surfaceContainerLow }]}
          >
            <View style={styles.whoText}>
              <Text style={styles.name} numberOfLines={1}>{me.data?.name ?? " "}</Text>
              <Text style={styles.email} numberOfLines={1}>{me.data?.email ?? " "}</Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.outline} />
          </Pressable>
          <View style={styles.divider} />
          <Item icon="logout" label="Log out" onPress={logOut} busy={signingOut} />
        </View>
      </Modal>
    </>
  );
}

function Item({ icon, label, onPress, busy = false }: { icon: IconName; label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceContainerLow }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.secondary} /> : <Icon name={icon} size={20} color={colors.onSurfaceVariant} />}
      <Text style={styles.itemText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatarRing: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: "rgba(59,130,246,0.4)",
    alignItems: "center", justifyContent: "center",
  },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  menu: {
    position: "absolute", right: 12, width: 240, backgroundColor: colors.surfaceContainerLowest, borderRadius: radii.card,
    paddingVertical: 6, ...shadows.floating,
  },
  who: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  whoText: { flex: 1, gap: 2 },
  name: { ...t.labelLg, color: colors.onSurface },
  email: { ...t.bodySm, color: colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: colors.outlineVariant, opacity: 0.5, marginVertical: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 16 },
  itemText: { ...t.bodyMd, color: colors.onSurface },
});
