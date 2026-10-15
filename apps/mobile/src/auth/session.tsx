import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Hub } from "aws-amplify/utils";
import { getCurrentUser } from "aws-amplify/auth";
import { useQueryClient } from "@tanstack/react-query";
import { setUnauthorizedHandler } from "../api/client";
import { signOut as amplifySignOut } from "./auth";
import { FIXTURES, fixtureScenario } from "../fixtures/fixtures";

type Status = "loading" | "signedIn" | "signedOut";
type Session = { status: Status; refresh: () => Promise<void>; signOut: () => Promise<void> };

const SessionContext = createContext<Session | null>(null);

// Holds whether someone is signed in. The root layout shows (auth) or (tabs) from this status,
// so every change here (sign-in, sign-out, an expired session) redirects by itself.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    if (FIXTURES) return setStatus(fixtureScenario() === "signedOut" ? "signedOut" : "signedIn");
    try {
      await getCurrentUser();
      setStatus("signedIn");
    } catch {
      setStatus("signedOut");
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (!FIXTURES) await amplifySignOut();
    } finally {
      queryClient.clear(); // no data of the previous user survives
      setStatus("signedOut");
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
    const stop = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn") setStatus("signedIn");
      if (payload.event === "signedOut" || payload.event === "tokenRefresh_failure") {
        queryClient.clear();
        setStatus("signedOut");
      }
    });
    return stop;
  }, [refresh, queryClient]);

  // the API client calls this on a 401
  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo(() => ({ status, refresh, signOut }), [status, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
