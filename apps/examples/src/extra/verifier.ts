import { OptimisticEventVerifier, type RelayVerificationState } from "applesauce-core";
import { verifyEvent as verifyEventJs, type NostrEvent } from "applesauce-core/helpers";
import localforage from "localforage";
import { initNostrWasm, type Nostr } from "nostr-wasm";
import { combineLatest, defer, map, Observable, of, startWith, switchMap, throttleTime } from "rxjs";

// Relay trust is shared by every example and survives reloads in IndexedDB
const storage = localforage.createInstance({ name: "examples-verifier" });

// The key prefix OptimisticEventVerifier uses when persisting relay evidence
const STORAGE_PREFIX = "applesauce:optimistic-verifier:v1:";

// Sampled signatures are checked with nostr-wasm, falling back to nostr-tools until the WASM module loads
let wasm: Nostr | undefined;
initNostrWasm().then((nw) => (wasm = nw));

function checkSignature(event: NostrEvent): boolean {
  if (!wasm) return verifyEventJs(event);
  try {
    wasm.verifyEvent(event);
    return true;
  } catch {
    return false;
  }
}

/** The optimistic verifier shared by all examples that are not about signature verification */
export const verifier = new OptimisticEventVerifier({
  // Smaller trust targets than the library defaults so trusted relays skip checks after a short browsing session
  verifiedEventsForTrust: 1000,
  daysForTrust: 1,
  verifiedEventsPerDay: 100,
  verifyEvent: checkSignature,
  storage,
});

/** Checks event signatures for an EventStore, skipping a growing share of checks for events from trusted relays */
export const verifyEvent = verifier.verifyEvent;

/** Observes the trust state of every relay seen this session or stored from earlier sessions */
export const relayTrust$: Observable<RelayVerificationState[]> = combineLatest([
  defer(() => storage.keys()).pipe(
    map((keys) => keys.filter((k) => k.startsWith(STORAGE_PREFIX)).map((k) => k.slice(STORAGE_PREFIX.length))),
    startWith([] as string[]),
  ),
  verifier.relays$,
]).pipe(
  map(([stored, seen]) => [...new Set([...stored, ...seen])]),
  switchMap((urls) => (urls.length ? combineLatest(urls.map((url) => verifier.relay$(url))) : of([]))),
  throttleTime(250, undefined, { leading: true, trailing: true }),
);

/** Deletes all stored relay trust and reloads the page so the verifier starts fresh */
export async function resetRelayTrust() {
  await storage.clear();
  location.reload();
}
