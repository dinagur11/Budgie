import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMyHouseholds } from "../api/hooks";
import type { MyHousehold } from "../api/types";

const STORAGE_KEY = "budgie.selectedHouseholdId";

type HouseholdState = {
  households: MyHousehold[] | undefined;
  // null while loading, or when the user has no households
  selectedId: number | null;
  select: (id: number) => void;
  query: ReturnType<typeof useMyHouseholds>;
};

const HouseholdContext = createContext<HouseholdState | null>(null);

// The household the app shows. The choice is kept in AsyncStorage; if it's missing or the user is no longer
// a member (it isn't in GET /me/households), the first household is used.
// enabled only while signed in, so nothing is fetched on the login screens
export function HouseholdProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const query = useMyHouseholds(enabled);
  const [stored, setStored] = useState<number | null | undefined>(undefined); // undefined = not read yet

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => setStored(v !== null && /^\d+$/.test(v) ? Number(v) : null))
      .catch(() => setStored(null));
  }, []);

  const select = useCallback((id: number) => {
    setStored(id);
    AsyncStorage.setItem(STORAGE_KEY, String(id)).catch(() => undefined);
  }, []);

  const households = query.data;
  const selectedId = useMemo(() => {
    if (!households || households.length === 0 || stored === undefined) return null;
    return households.some((h) => h.householdId === stored) ? stored! : households[0].householdId;
  }, [households, stored]);

  const value = useMemo(() => ({ households, selectedId, select, query }), [households, selectedId, select, query]);
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHouseholdSelection(): HouseholdState {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHouseholdSelection must be used inside HouseholdProvider");
  return ctx;
}
