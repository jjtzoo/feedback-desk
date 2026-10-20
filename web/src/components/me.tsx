"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api, type Me } from "@/lib/api";

const MeContext = createContext<Me | null>(null);

/** Loads the signed-in person once; the API redirects to /sign-in if there's no session. */
export function MeProvider({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api.get<Me>("/me").then(setMe).catch(() => undefined);
  }, []);
  if (!me) return <>{fallback ?? <div className="min-h-dvh" aria-busy="true" />}</>;
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside MeProvider");
  return me;
}
