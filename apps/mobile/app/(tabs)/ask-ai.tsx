import { useEffect, useRef, useState } from "react";
import { Animated, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { AppHeader, useBackToHouseholds } from "../../src/components/AppHeader";
import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { HouseholdSwitcher } from "../../src/components/HouseholdSwitcher";
import { Icon } from "../../src/components/Icon";
import { Placeholder } from "../../src/components/Placeholder";
import { Screen } from "../../src/components/Screen";
import { ErrorView, LoadingView } from "../../src/components/StateViews";
import { useHouseholdSelection } from "../../src/household/HouseholdContext";
import { useAsk, useMe } from "../../src/api/hooks";
import { errorMessage } from "../../src/api/errors";
import { JOIN_PREMIUM_ROUTE } from "../../src/lib/premium";
import {
  askErrorMessage, buildHistory, canRetryAsk, EXAMPLE_QUESTIONS, isPremiumRequired, MAX_QUESTION_LENGTH, type ChatMessage,
} from "../../src/lib/ask";
import { colors, fonts, MIN_TOUCH, radii, spacing, type as t } from "../../src/theme";

// Questions about the selected household's spending in plain English (premium only). The chat lives in memory: it
// starts over when the household changes and is gone after signing out. Users who aren't premium see the upsell.
export default function AskAiScreen() {
  const back = useBackToHouseholds();
  const { selectedId } = useHouseholdSelection();
  const me = useMe();
  // the backend said "Premium required" (premium was removed since /me was loaded)
  const [denied, setDenied] = useState(false);
  const header = <AppHeader onBack={back} center={selectedId !== null ? <HouseholdSwitcher /> : undefined} />;

  if (selectedId === null)
    return (
      <Screen inTabs header={header}>
        <Placeholder icon="auto-awesome" title="No household yet" text="Create a household to ask about its spending." />
      </Screen>
    );
  if (me.isError)
    return <Screen inTabs header={header}><Card><ErrorView message={errorMessage(me.error)} onRetry={() => me.refetch()} /></Card></Screen>;
  if (!me.data) return <Screen inTabs header={header}><LoadingView /></Screen>;
  if (!me.data.isPremium || denied) return <Screen inTabs header={header}><PremiumUpsell /></Screen>;

  return (
    <View style={styles.root}>
      {header}
      {/* keyed by household, so switching households starts a new conversation */}
      <Chat key={selectedId} householdId={selectedId} onPremiumRequired={() => setDenied(true)} />
    </View>
  );
}

function PremiumUpsell() {
  return (
    <Card style={styles.upsell}>
      <Icon name="workspace-premium" size={32} color={colors.secondary} />
      <Text style={styles.upsellTitle}>Ask AI</Text>
      <Text style={styles.upsellText}>This feature is only available for premium users.</Text>
      <Button
        label="Join now"
        onPress={() => router.push(JOIN_PREMIUM_ROUTE)}
      />
    </Card>
  );
}

function Chat({ householdId, onPremiumRequired }: { householdId: number; onPremiumRequired: () => void }) {
  const ask = useAsk(householdId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);
  const scroll = useRef<ScrollView>(null);

  // sends a question that is already on screen; `before` is the chat up to (not including) it, for the history
  function run(question: string, before: ChatMessage[]) {
    setPending(true);
    ask
      .mutateAsync({ question, history: buildHistory(before) })
      .then(({ answer }) => setMessages((m) => [...m, { id: nextId.current++, kind: "answer", text: answer }]))
      .catch((error: unknown) => {
        if (isPremiumRequired(error)) return onPremiumRequired();
        setMessages((m) => [
          ...m,
          { id: nextId.current++, kind: "error", text: askErrorMessage(error), question, canRetry: canRetryAsk(error) },
        ]);
      })
      .finally(() => setPending(false));
  }

  function send(text: string) {
    const question = text.trim();
    if (question === "" || pending) return;
    setMessages((m) => [...m, { id: nextId.current++, kind: "question", text: question }]);
    setDraft("");
    run(question, messages);
  }

  // resends the failed question (the last one) without adding it again: the error bubble goes away, the question stays
  function retry(error: Extract<ChatMessage, { kind: "error" }>) {
    if (pending) return;
    const rest = messages.filter((m) => m.id !== error.id);
    setMessages(rest);
    run(error.question, rest.slice(0, -1));
  }

  const canSend = draft.trim() !== "" && !pending;
  return (
    // Android draws edge to edge, so the keyboard is avoided with padding (like Screen)
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        <View style={styles.column}>
          {messages.length === 0 && <EmptyChat onPick={send} disabled={pending} />}
          {messages.map((m, i) =>
            m.kind === "question" ? (
              <View key={m.id} style={[styles.bubble, styles.question]}>
                <Text style={styles.questionText}>{m.text}</Text>
              </View>
            ) : m.kind === "answer" ? (
              <View key={m.id} style={[styles.bubble, styles.answer]}>
                <Text style={styles.answerText} selectable>{m.text}</Text>
              </View>
            ) : (
              <View key={m.id} style={[styles.bubble, styles.error]} accessibilityLiveRegion="polite">
                <Text style={styles.errorText}>{m.text}</Text>
                {/* only the latest failure: an older one's answer would land out of order */}
                {m.canRetry && i === messages.length - 1 && (
                  <Pressable onPress={() => retry(m)} disabled={pending} accessibilityRole="button" style={styles.retry}>
                    <Icon name="refresh" size={18} color={colors.onErrorContainer} />
                    <Text style={styles.retryText}>Retry</Text>
                  </Pressable>
                )}
              </View>
            ),
          )}
          {pending && <TypingBubble />}
        </View>
      </ScrollView>
      <View style={styles.composer}>
        <View style={styles.composerRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask about your spending"
            placeholderTextColor={colors.outline}
            maxLength={MAX_QUESTION_LENGTH}
            multiline
            accessibilityLabel="Question"
            style={styles.input}
          />
          <Pressable
            onPress={() => send(draft)}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            style={[styles.send, !canSend && styles.sendDisabled]}
          >
            <Icon name="send" size={20} color={colors.onSecondary} />
          </Pressable>
        </View>
        {draft.length >= MAX_QUESTION_LENGTH - 50 && (
          <Text style={styles.counter}>{draft.length}/{MAX_QUESTION_LENGTH}</Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function EmptyChat({ onPick, disabled }: { onPick: (question: string) => void; disabled: boolean }) {
  return (
    <Card style={styles.empty}>
      <Icon name="auto-awesome" size={28} color={colors.secondary} />
      <Text style={styles.emptyTitle}>Ask about your spending</Text>
      <Text style={styles.emptyText}>Questions in plain English, answered from this household's expenses.</Text>
      <View style={styles.examples}>
        {EXAMPLE_QUESTIONS.map((q) => (
          <Pressable key={q} onPress={() => onPick(q)} disabled={disabled} accessibilityRole="button" style={styles.example}>
            <Text style={styles.exampleText}>{q}</Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

// three dots fading in turn while the answer is on its way
function TypingBubble() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.stagger(
        150,
        dots.map((d) =>
          Animated.sequence([
            Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.timing(d, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [dots]);
  return (
    <View style={[styles.bubble, styles.answer, styles.typing]} accessibilityLabel="Answering" accessibilityLiveRegion="polite">
      {dots.map((d, i) => <Animated.View key={i} style={[styles.dot, { opacity: d }]} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  listContent: { flexGrow: 1, paddingHorizontal: spacing.gutter, paddingTop: 2, paddingBottom: spacing.lg },
  column: { width: "100%", maxWidth: spacing.maxContentWidth, alignSelf: "center", gap: 10 },
  bubble: { maxWidth: "85%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  question: { alignSelf: "flex-end", backgroundColor: colors.secondary, borderBottomRightRadius: 4 },
  questionText: { ...t.bodyMd, color: colors.onSecondary },
  answer: { alignSelf: "flex-start", backgroundColor: colors.surfaceContainerLowest, borderBottomLeftRadius: 4 },
  answerText: { ...t.bodyMd, color: colors.onSurface },
  error: { alignSelf: "flex-start", backgroundColor: colors.errorContainer, borderBottomLeftRadius: 4, gap: 4 },
  errorText: { ...t.bodyMd, color: colors.onErrorContainer },
  retry: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: MIN_TOUCH, alignSelf: "flex-start" },
  retryText: { ...t.labelLg, color: colors.onErrorContainer },
  typing: { flexDirection: "row", gap: 6, paddingVertical: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.outline },
  empty: { alignItems: "center", paddingVertical: 24, gap: 8 },
  emptyTitle: { ...t.headlineSm, color: colors.onSurface },
  emptyText: { ...t.bodyMd, color: colors.onSurfaceVariant, textAlign: "center" },
  examples: { alignSelf: "stretch", gap: 8, marginTop: 8 },
  example: {
    minHeight: MIN_TOUCH, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radii.row, backgroundColor: colors.surfaceContainerLow,
  },
  exampleText: { ...t.bodyMd, color: colors.secondary, fontFamily: fonts.inter500 },
  composer: { paddingHorizontal: spacing.gutter, paddingTop: 8, paddingBottom: 10, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant },
  composerRow: { width: "100%", maxWidth: spacing.maxContentWidth, alignSelf: "center", flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1, minHeight: MIN_TOUCH, maxHeight: 120, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    borderRadius: 22, backgroundColor: colors.surfaceContainerLowest, borderWidth: 1, borderColor: colors.outlineVariant,
    ...t.bodyMd, color: colors.onSurface,
  },
  send: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
  sendDisabled: { opacity: 0.4 },
  counter: { ...t.bodySm, color: colors.onSurfaceVariant, textAlign: "right", width: "100%", maxWidth: spacing.maxContentWidth, alignSelf: "center", marginTop: 4 },
  upsell: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 20, gap: 10 },
  upsellTitle: { ...t.headlineSm, color: colors.onSurface },
  upsellText: { ...t.bodyMd, color: colors.onSurfaceVariant, textAlign: "center", marginBottom: 6 },
});
