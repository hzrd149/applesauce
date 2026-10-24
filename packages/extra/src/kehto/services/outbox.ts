import type { OutboxQueryOptions, OutboxRelayPlan, OutboxRouter } from "@kehto/services";
import { getSeenRelays, kinds, mergeRelaySets, type Filter, type NostrEvent } from "applesauce-core/helpers";
import { concatMap, defer, filter } from "rxjs";
import { publishThroughStore, queryThroughStore, subscribeThroughStore } from "../foundation/pool.js";
import { getStoredInboxes, selectReadRelays, selectWriteRelays } from "../foundation/relays.js";
import { signForNapplet } from "../foundation/signer.js";
import type { KehtoState } from "../foundation/state.js";
import { errorMessage, settle } from "../helpers.js";

/** Wraps an event in a kehto relay event result with the relays it was seen on */
export function toRelayEventResult(event: NostrEvent) {
  const seen = getSeenRelays(event);
  return seen?.size ? { event, sidecar: { relayHints: [...seen] } } : { event };
}

/** Loads missing NIP-65 relay lists through the store's loader, so many authors share a few requests */
async function loadRelayLists(state: KehtoState, pubkeys: string[]) {
  const { eventStore } = state.ctx;
  const missing = pubkeys.filter((pubkey) => !eventStore.hasReplaceable(kinds.RelayList, pubkey));
  await Promise.all(
    missing.map((pubkey) => settle(eventStore.replaceable(kinds.RelayList, pubkey), undefined, state.timeout)),
  );
}

/** Plans relays for reading users' events (their outboxes) or writing to them (their inboxes) */
export async function planOutboxRelays(
  state: KehtoState,
  pubkeys: string[],
  direction: "read" | "write" = "read",
): Promise<OutboxRelayPlan> {
  if (pubkeys.length === 0)
    return {
      relays: direction === "write" ? selectWriteRelays(state) : selectReadRelays(state, [{}]),
      source: "policy",
    };

  await loadRelayLists(state, pubkeys);
  const { eventStore } = state.ctx;
  const missingAuthors = pubkeys.filter((pubkey) => !eventStore.hasReplaceable(kinds.RelayList, pubkey));
  const relays =
    direction === "read"
      ? selectReadRelays(state, [{ authors: pubkeys }])
      : mergeRelaySets(...pubkeys.map((pubkey) => getStoredInboxes(state, pubkey)));

  return {
    relays: relays.length ? relays : state.getFallbackRelays(),
    source: missingAuthors.length === pubkeys.length ? "fallback" : "nip65",
    ...(missingAuthors.length ? { missingAuthors } : {}),
  };
}

/** Uses explicit relays when given, otherwise the outboxes of the requested authors */
async function readRelays(state: KehtoState, filters: Filter[], options?: OutboxQueryOptions) {
  if (options?.relays?.length) return options.relays;
  const authors = options?.authors ?? filters.flatMap((f) => f.authors ?? []);
  return (await planOutboxRelays(state, [...new Set(authors)])).relays;
}

/**
 * Creates a NAP-OUTBOX {@link OutboxRouter} on the event store and its loaders
 * @param getWindowId returns the napplet window publishing, used for the signing approval
 */
export function createOutboxRouter(state: KehtoState, getWindowId?: () => string | undefined): OutboxRouter {
  const { eventStore } = state.ctx;

  return {
    resolveRelays: ({ authors = [], pubkey, direction }) =>
      planOutboxRelays(state, pubkey ? [pubkey] : authors, direction),
    getEvent: async (id, options) => {
      // The store's event loader batches lookups from every napplet into shared requests
      const pointer = { id, author: options?.author, relays: options?.relays };
      const event = await settle(eventStore.event(pointer), undefined, options?.timeoutMs ?? state.timeout);
      return event ? { result: toRelayEventResult(event) } : { error: "not found" };
    },
    // Kehto's NostrFilter is structurally a NIP-01 filter
    query: async (nostrFilters, options) => {
      const filters = nostrFilters as Filter[];
      const events = await queryThroughStore(state, await readRelays(state, filters, options), filters, options?.limit);
      return { events: events.map(toRelayEventResult) };
    },
    subscribe: (nostrFilters, options, sink) => {
      const filters = nostrFilters as Filter[];
      const sub = defer(() => readRelays(state, filters, options))
        .pipe(
          concatMap((relays) => subscribeThroughStore(state, relays, filters)),
          filter((item): item is NostrEvent => item !== "EOSE"),
        )
        .subscribe({
          next: (event) => sink.event(toRelayEventResult(event)),
          error: (err) => sink.closed(errorMessage(err)),
        });
      return { close: () => sub.unsubscribe() };
    },
    publish: async (template, options = {}) => {
      try {
        const event = await signForNapplet(state, template, getWindowId?.());
        const inboxes = options.toInboxes?.length
          ? (await planOutboxRelays(state, options.toInboxes, "write")).relays
          : [];
        const outboxes = options.toOutbox === false ? [] : selectWriteRelays(state);
        const results = await publishThroughStore(state, mergeRelaySets(options.relays, outboxes, inboxes), event);
        return { ok: true, event, eventId: event.id, relays: Object.fromEntries(results.map((r) => [r.from, r.ok])) };
      } catch (err) {
        return { ok: false, error: errorMessage(err, "rejected") };
      }
    },
  };
}
