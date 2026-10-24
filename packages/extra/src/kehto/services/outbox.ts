import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { KehtoAccount } from "../foundation/account.js";
import type { KehtoSignRequest } from "../types.js";
import type { EncryptedContentCache } from "applesauce-common/helpers";
import type { OutboxQueryOptions, OutboxRelayPlan, OutboxRouter } from "@kehto/services";
import {
  getSeenRelays,
  kinds,
  mergeRelaySets,
  selectOptimalRelays,
  setFallbackRelays,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import { includeMailboxes } from "applesauce-core/observable";
import {
  combineLatest,
  concatMap,
  defer,
  distinct,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  of,
  switchMap,
} from "rxjs";
import { kehtoAccount$ } from "../foundation/account.js";
import { decryptForNapplet, decryptForNapplet$ } from "../foundation/encryption.js";
import { publishThroughStore, queryThroughStore, subscribeThroughStore } from "../foundation/pool.js";
import {
  getStoredInboxes,
  getStoredOutboxes,
  selectReadRelays,
  selectWriteRelays,
} from "../foundation/relays.js";
import { signForNapplet } from "../foundation/signer.js";
import { configured$, errorMessage, settle } from "../helpers.js";

/** Options for {@link createOutboxRouter} */
export interface KehtoOutboxOptions {
  /** The shared event store with host loaders configured */
  eventStore: EventStore;
  /** The relay pool used for napplet traffic */
  pool: RelayPool;
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The shared resolved account stream, overriding signer resolution when provided */
  account$?: Observable<KehtoAccount | undefined>;
  /** The wait for missing data in milliseconds (default 4000) */
  timeout?: number;
  /** The relays used when user relay lists are unavailable */
  fallbackRelays?: string[] | Observable<string[]>;
  /** The host callback approving a napplet signing request */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
  /** Whether reads decrypt encrypted event content (default true) */
  decrypt?: boolean;
  /** The host plaintext cache keyed by account public key and event id */
  decryptionCache?: EncryptedContentCache;
  /** The napplet window making the current request */
  getWindowId?: () => string | undefined;
}

/** Wraps an event in a kehto relay event result with the relays it was seen on */
export function toRelayEventResult(event: NostrEvent) {
  const seen = getSeenRelays(event);
  return seen?.size ? { event, sidecar: { relayHints: [...seen] } } : { event };
}

/** Loads missing NIP-65 relay lists through the store's loader, so many authors share a few requests */
async function loadRelayLists(config: KehtoOutboxOptions, pubkeys: string[]) {
  const { eventStore } = config;
  const missing = pubkeys.filter((pubkey) => !eventStore.hasReplaceable(kinds.RelayList, pubkey));
  await Promise.all(
    missing.map((pubkey) => settle(eventStore.replaceable(kinds.RelayList, pubkey), undefined, config.timeout ?? 4000)),
  );
}

/** Plans relays for reading users' events (their outboxes) or writing to them (their inboxes) */
export async function planOutboxRelays(
  config: KehtoOutboxOptions,
  pubkeys: string[],
  direction: "read" | "write" = "read",
): Promise<OutboxRelayPlan> {
  const account = await firstValueFrom(kehtoAccount$(config));
  const fallback = await firstValueFrom(configured$(config.fallbackRelays, []));

  if (pubkeys.length === 0)
    return {
      relays:
        direction === "write"
          ? selectWriteRelays(config.eventStore, account?.pubkey, fallback)
          : selectReadRelays(config.eventStore, [{}], account?.pubkey, fallback),
      source: "policy",
    };

  await loadRelayLists(config, pubkeys);
  const { eventStore } = config;
  const missingAuthors = pubkeys.filter((pubkey) => !eventStore.hasReplaceable(kinds.RelayList, pubkey));
  const relays =
    direction === "read"
      ? selectReadRelays(config.eventStore, [{ authors: pubkeys }], account?.pubkey, fallback)
      : mergeRelaySets(...pubkeys.map((pubkey) => getStoredInboxes(config.eventStore, pubkey)));

  return {
    relays: relays.length ? relays : fallback,
    source: missingAuthors.length === pubkeys.length ? "fallback" : "nip65",
    ...(missingAuthors.length ? { missingAuthors } : {}),
  };
}

/** Observes author outboxes and fallback settings for the lifetime of a read */
function readRelays$(config: KehtoOutboxOptions, filters: Filter[], options?: OutboxQueryOptions) {
  if (options?.relays?.length) return of(options.relays);

  const authors = [...new Set(options?.authors ?? filters.flatMap((filter) => filter.authors ?? []))];
  const users$ = of(authors.map((pubkey) => ({ pubkey }))).pipe(includeMailboxes(config.eventStore));
  const fallbackRelays$ = configured$(config.fallbackRelays, []);

  const inboxes$ = kehtoAccount$(config).pipe(
    switchMap((account) =>
      of(account ? [{ pubkey: account.pubkey }] : []).pipe(includeMailboxes(config.eventStore, "inbox")),
    ),
  );

  return combineLatest([users$, inboxes$, fallbackRelays$]).pipe(
    map(([users, inboxes, fallback]) => {
      const defaults = mergeRelaySets(...inboxes.map((user) => user.relays), fallback);
      if (users.length === 0) return defaults;

      const selected = selectOptimalRelays(setFallbackRelays(users, defaults), {
        maxConnections: 12,
        maxRelaysPerUser: 3,
      });
      return mergeRelaySets(selected.flatMap((user) => user.relays ?? []));
    }),
    distinctUntilChanged(
      (previous, current) => previous.length === current.length && previous.every((relay) => current.includes(relay)),
    ),
  );
}

/** Creates a NAP-OUTBOX {@link OutboxRouter} on the event store and its loaders */
export function createOutboxRouter(config: KehtoOutboxOptions): OutboxRouter {
  const { eventStore } = config;

  return {
    resolveRelays: ({ authors = [], pubkey, direction }) =>
      planOutboxRelays(config, pubkey ? [pubkey] : authors, direction),
    getEvent: async (id, options) => {
      // The store's event loader batches lookups from every napplet into shared requests
      const pointer = { id, author: options?.author, relays: options?.relays };
      const event = await settle(eventStore.event(pointer), undefined, options?.timeoutMs ?? config.timeout ?? 4000);
      if (!event) return { error: "not found" };

      const decryptedEvent = await decryptForNapplet(config, event);
      return { result: toRelayEventResult(decryptedEvent) };
    },
    // Kehto's NostrFilter is structurally a NIP-01 filter
    query: async (nostrFilters, options) => {
      const filters = nostrFilters as Filter[];
      const authors = options?.authors ?? filters.flatMap((filter) => filter.authors ?? []);
      const relays = options?.relays?.length
        ? options.relays
        : (await planOutboxRelays(config, [...new Set(authors)])).relays;
      const events = await queryThroughStore(config, relays, filters, options?.limit);

      // Kehto expects a promise here; subscription paths keep their observable pipeline.
      const results = await Promise.all(
        events.map(async (event) => {
          const decryptedEvent = await decryptForNapplet(config, event);
          return toRelayEventResult(decryptedEvent);
        }),
      );
      return { events: results };
    },
    subscribe: (nostrFilters, options, sink) => {
      const filters = nostrFilters as Filter[];
      const subscription = defer(() => readRelays$(config, filters, options))
        .pipe(
          switchMap((relays) => subscribeThroughStore(config, relays, filters)),
          filter((item): item is NostrEvent => item !== "EOSE"),
          distinct((event) => event.id),
          // Keep event order and cancel queued decryptions when the napplet closes.
          concatMap((event) => decryptForNapplet$(config, event)),
        )
        .subscribe({
          next: (event) => sink.event(toRelayEventResult(event)),
          error: (err) => sink.closed(errorMessage(err)),
        });
      return { close: () => subscription.unsubscribe() };
    },
    publish: async (template, options = {}) => {
      const windowId = config.getWindowId?.();

      try {
        const account = await firstValueFrom(kehtoAccount$(config));
        if (!account) throw new Error("No signer configured");

        const event = await signForNapplet(account.signer, template, {
          approve: config.approve,
          windowId,
        });
        const inboxes = options.toInboxes?.length
          ? (await planOutboxRelays(config, options.toInboxes, "write")).relays
          : [];
        const storedOutboxes = getStoredOutboxes(config.eventStore, account.pubkey);
        const outboxes =
          options.toOutbox === false
            ? []
            : storedOutboxes.length
              ? storedOutboxes
              : await firstValueFrom(configured$(config.fallbackRelays, []));
        const relays = mergeRelaySets(options.relays, outboxes, inboxes);
        const results = await publishThroughStore(config, relays, event);

        return {
          ok: true,
          event,
          eventId: event.id,
          relays: Object.fromEntries(results.map((result) => [result.from, result.ok])),
        };
      } catch (err) {
        return { ok: false, error: errorMessage(err, "rejected") };
      }
    },
  };
}
