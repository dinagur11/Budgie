import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// The token of an invite link that opened the app, until the join screen takes it. Kept in AsyncStorage too, so it
// survives the app being closed while a new user registers (the email code can take them to another app).
// Never logged.
const STORAGE_KEY = "budgie.pendingInvite";

let token: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null) {
  token = next;
  listeners.forEach((l) => l());
  (next === null ? AsyncStorage.removeItem(STORAGE_KEY) : AsyncStorage.setItem(STORAGE_KEY, next)).catch(() => undefined);
}

// a stored token from an earlier launch, unless a link already set one
AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    if (stored && token === null) {
      token = stored;
      listeners.forEach((l) => l());
    }
  })
  .catch(() => undefined);

export function setPendingInvite(next: string) {
  set(next);
}

// the join screen takes the token once; afterwards it lives only in that screen
export function takePendingInvite(): string | null {
  const current = token;
  if (current !== null) set(null);
  return current;
}

export function usePendingInvite(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => token,
  );
}
