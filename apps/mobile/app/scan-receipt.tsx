import { useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Screen } from "../src/components/Screen";
import { Card } from "../src/components/Card";
import { Button } from "../src/components/Button";
import { Icon } from "../src/components/Icon";
import { useHouseholdSelection } from "../src/household/HouseholdContext";
import { useReceiptScan } from "../src/api/receiptScan";
import { canRetryReceipt, receiptErrorMessage } from "../src/lib/receipt";
import { colors, type as t } from "../src/theme";

type Source = "camera" | "library";
type Photo = { uri: string; width: number; height: number };
type View_ = { kind: "choose"; note?: string } | { kind: "notReceipt" } | { kind: "error"; message: string; retry: boolean };

// The "+" menu's "Photograph Receipt": take or pick a photo, upload it and have it read, then open the create-expense
// form prefilled with the suggestion. Nothing is saved until the user confirms the form.
export default function ScanReceiptScreen() {
  const { selectedId } = useHouseholdSelection();
  const { scan, stage, busy } = useReceiptScan(selectedId);
  const [view, setView] = useState<View_>({ kind: "choose" });
  const [picking, setPicking] = useState(false);
  const lastSource = useRef<Source>("camera");
  const lastPhoto = useRef<Photo | null>(null);

  const enterManually = () => router.replace("/create-expense");

  async function run(photo: Photo) {
    try {
      const suggestion = await scan(photo);
      if (!suggestion) return; // screen left, or a scan already running
      if (!suggestion.isReceipt) {
        setView({ kind: "notReceipt" });
        return;
      }
      router.replace({ pathname: "/create-expense", params: { receipt: JSON.stringify(suggestion) } });
    } catch (err) {
      setView({ kind: "error", message: receiptErrorMessage(err), retry: canRetryReceipt(err) });
    }
  }

  async function pick(source: Source) {
    if (busy || picking) return;
    setPicking(true);
    lastSource.current = source;
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setView({ kind: "choose", note: "Budgie needs the camera to photograph a receipt. Allow it in the system settings, or choose a photo from the gallery." });
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, exif: false };
      const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) return;
      const { uri, width, height } = result.assets[0];
      lastPhoto.current = { uri, width, height };
      setView({ kind: "choose" });
      await run(lastPhoto.current);
    } catch {
      setView({ kind: "choose", note: "Couldn't open the camera or gallery. Please try again." });
    } finally {
      setPicking(false);
    }
  }

  // the whole upload and analysis again with the same photo (each analysis deletes the uploaded image)
  async function retry() {
    if (!lastPhoto.current || busy) return;
    setView({ kind: "choose" });
    await run(lastPhoto.current);
  }

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.title}>Photograph receipt</Text>
        {selectedId === null ? (
          <Text style={styles.text}>Create a household first.</Text>
        ) : busy ? (
          <View style={styles.center} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.secondary} />
            <Text style={styles.text}>{stage === "reading" ? "Reading receipt…" : "Uploading…"}</Text>
          </View>
        ) : view.kind === "notReceipt" ? (
          <>
            <Message icon="image-not-supported" text="That doesn't look like a receipt" />
            <Button label="Retake" icon="photo-camera" onPress={() => void pick(lastSource.current)} />
            <Button label="Enter manually" variant="tonal" onPress={enterManually} />
          </>
        ) : view.kind === "error" ? (
          <>
            <Message icon="cloud-off" text={view.message} />
            {view.retry && <Button label="Try again" icon="refresh" onPress={() => void retry()} />}
            <Button label="Enter manually" variant="tonal" onPress={enterManually} />
          </>
        ) : (
          <>
            <Text style={styles.text}>Take a photo of a receipt, or choose one from the gallery. Budgie reads it and fills in the expense for you to check.</Text>
            {view.note && <Text style={styles.note}>{view.note}</Text>}
            <Button label="Take photo" icon="photo-camera" onPress={() => void pick("camera")} disabled={picking} />
            <Button label="Choose from gallery" icon="photo-library" variant="tonal" onPress={() => void pick("library")} disabled={picking} />
          </>
        )}
        {/* leaving while a scan runs is allowed: its result is ignored */}
        <Button label="Cancel" variant="text" onPress={() => router.back()} />
      </Card>
    </Screen>
  );
}

function Message({ icon, text }: { icon: "image-not-supported" | "cloud-off"; text: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <Icon name={icon} size={28} color={colors.outline} />
      <Text style={styles.message}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  title: { ...t.headlineMd, color: colors.onSurface },
  center: { alignItems: "center", gap: 10, paddingVertical: 24 },
  text: { ...t.bodyMd, color: colors.onSurfaceVariant },
  note: { ...t.bodyMd, color: colors.error },
  message: { ...t.bodyLg, color: colors.onSurface, textAlign: "center" },
});
