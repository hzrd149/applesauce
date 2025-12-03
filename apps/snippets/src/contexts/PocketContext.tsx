import { createContext, useContext, type ReactNode } from "react";
import { usePocket } from "../hooks/usePocket";
import { type NostrEvent } from "nostr-tools";
import { type PocketItem } from "../hooks/usePocket";

interface PocketContextType {
  pocketItems: PocketItem[];
  addToPocket: (event: NostrEvent) => boolean;
  removeFromPocket: (eventId: string) => void;
  clearPocket: () => void;
  isInPocket: (eventId: string) => boolean;
  exportAsMarkdown: () => string;
  downloadAsMarkdown: () => void;
  copyAsMarkdown: () => Promise<boolean>;
}

const PocketContext = createContext<PocketContextType | undefined>(undefined);

interface PocketProviderProps {
  children: ReactNode;
}

export function PocketProvider({ children }: PocketProviderProps) {
  const pocketHook = usePocket();

  return <PocketContext.Provider value={pocketHook}>{children}</PocketContext.Provider>;
}

export function usePocketContext() {
  const context = useContext(PocketContext);
  if (context === undefined) {
    throw new Error("usePocketContext must be used within a PocketProvider");
  }
  return context;
}
