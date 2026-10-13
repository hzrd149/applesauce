import { relaySet } from "applesauce-core/helpers";
import { BehaviorSubject } from "rxjs";

/** The lookup relays used when no user settings are saved */
export const DEFAULT_LOOKUP_RELAYS = relaySet(["wss://purplepag.es/", "wss://indexer.coracle.social", "wss://relay.vertexlab.io/"]);

const LOOKUP_RELAYS_KEY = "settings:lookup-relays";

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

/** Creates a BehaviorSubject that persists its value to localStorage */
function persistentSetting<T>(key: string, fallback: T): BehaviorSubject<T> {
  const subject = new BehaviorSubject<T>(loadSetting(key, fallback));
  subject.subscribe((value) => localStorage.setItem(key, JSON.stringify(value)));
  return subject;
}

/** The lookup relays used by all examples to find profiles and relay lists */
export const lookupRelays$ = persistentSetting<string[]>(LOOKUP_RELAYS_KEY, DEFAULT_LOOKUP_RELAYS);
