"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, type Counts } from "@/lib/api";

interface CountsValue {
  counts: Counts | null;
  refresh: () => void;
}

const CountsContext = createContext<CountsValue>({ counts: null, refresh: () => undefined });

/** The sidebar and the Work tabs share one set of counts. They refresh on load, on focus and when a page changes an item. */
export function CountsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<Counts | null>(null);

  const refresh = useCallback(() => {
    api.get<Counts>("/console/counts").then(setCounts).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const value = useMemo(() => ({ counts, refresh }), [counts, refresh]);
  return <CountsContext.Provider value={value}>{children}</CountsContext.Provider>;
}

export function useCounts(): CountsValue {
  return useContext(CountsContext);
}
