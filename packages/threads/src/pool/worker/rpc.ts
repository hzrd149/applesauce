import { RelayPool } from "applesauce-relay/pool";
import { isObservable, map, of } from "rxjs";
import { RPCServer } from "../../common/rpc-server.js";
import type { AllRelayCommands } from "../commands.js";

/**
 * Creates a RelayPool RPC server.
 * This should be called from within the worker script.
 *
 * @param options - Optional RelayOptions to pass to the RelayPool constructor
 */
export function createPoolWorkerRPC(pool: RelayPool): RPCServer<AllRelayCommands> {
  const server = new RPCServer<AllRelayCommands>();

  // Expose relays$ observable
  server.register("poolRelays$", () => {
    return pool.relays$.pipe(
      map((relays) => {
        // Serialize Map to array of [key, value] tuples
        // For now, we'll just return the URLs since IRelay can't be fully serialized
        return Array.from(relays.keys()).map((url) => [url, { url }] as [string, unknown]);
      }),
    );
  });

  // Expose add$ observable
  server.register("poolAdd$", () => {
    return pool.add$.pipe(map((relay) => ({ url: relay.url })));
  });

  // Expose remove$ observable
  server.register("poolRemove$", () => {
    return pool.remove$.pipe(map((relay) => ({ url: relay.url })));
  });

  // relay() - returns relay URL as identifier
  server.register("poolRelay", ([url]) => {
    const relay = pool.relay(url);
    return of({ url: relay.url });
  });

  // remove()
  server.register("poolRemove", ([relay, close]) => {
    pool.remove(relay, close ?? true);
    return of(void 0);
  });

  // req()
  server.register("poolReq", ([relays, filters, id]) => {
    return pool.req(relays, filters, id);
  });

  // event()
  server.register("poolEvent", ([relays, event]) => {
    return pool.event(relays, event);
  });

  // request()
  server.register("poolRequest", ([relays, filters, opts]) => {
    return pool.request(relays, filters, opts);
  });

  // subscription()
  server.register("poolSubscription", ([relays, filters, options]) => {
    return pool.subscription(relays, filters, options);
  });

  // count()
  server.register("poolCount", ([relays, filters, id]) => {
    return pool.count(relays, filters, id);
  });

  // sync()
  server.register("poolSync", ([relays, store, filter, direction]) => {
    return pool.sync(relays, store, filter, direction);
  });

  // negentropy() - returns Promise
  server.register("poolNegentropy", async ([relays, store, filter, reconcile, opts]) => {
    return await pool.negentropy(relays, store, filter, reconcile, opts);
  });

  // publish() - returns Promise
  server.register("poolPublish", async ([relays, event, opts]) => {
    return await pool.publish(relays, event, opts);
  });

  // subscriptionMap()
  server.register("poolSubscriptionMap", ([relays, options]) => {
    // Convert FilterMap to Observable<FilterMap> if needed
    const relays$ = isObservable(relays) ? relays : of(relays);
    return pool.subscriptionMap(relays$, options);
  });

  // outboxSubscription()
  server.register("poolOutboxSubscription", ([outboxes, filter, options]) => {
    // Convert OutboxMap to Observable<OutboxMap> if needed
    const outboxes$ = isObservable(outboxes) ? outboxes : of(outboxes);
    return pool.outboxSubscription(outboxes$, filter, options);
  });

  // Relay-specific commands
  server.register("relayMessage$", ([url]) => {
    const relay = pool.relay(url);
    return relay.message$;
  });

  server.register("relayNotice$", ([url]) => {
    const relay = pool.relay(url);
    return relay.notice$;
  });

  server.register("relayConnected$", ([url]) => {
    const relay = pool.relay(url);
    return relay.connected$;
  });

  server.register("relayChallenge$", ([url]) => {
    const relay = pool.relay(url);
    return relay.challenge$;
  });

  server.register("relayAuthenticated$", ([url]) => {
    const relay = pool.relay(url);
    return relay.authenticated$;
  });

  server.register("relayNotices$", ([url]) => {
    const relay = pool.relay(url);
    return relay.notices$;
  });

  server.register("relayOpen$", ([url]) => {
    const relay = pool.relay(url);
    return relay.open$;
  });

  server.register("relayClose$", ([url]) => {
    const relay = pool.relay(url);
    return relay.close$;
  });

  server.register("relayClosing$", ([url]) => {
    const relay = pool.relay(url);
    return relay.closing$;
  });

  server.register("relayError$", ([url]) => {
    const relay = pool.relay(url);
    return relay.error$;
  });

  server.register("relayConnected", ([url]) => {
    const relay = pool.relay(url);
    return of(relay.connected);
  });

  server.register("relayAuthenticated", ([url]) => {
    const relay = pool.relay(url);
    return of(relay.authenticated);
  });

  server.register("relayChallenge", ([url]) => {
    const relay = pool.relay(url);
    return of(relay.challenge);
  });

  server.register("relayNotices", ([url]) => {
    const relay = pool.relay(url);
    return of(relay.notices);
  });

  server.register("relayClose", ([url]) => {
    const relay = pool.relay(url);
    relay.close();
    return of(void 0);
  });

  server.register("relayReq", ([url, filters, id]) => {
    const relay = pool.relay(url);
    return relay.req(filters, id);
  });

  server.register("relayCount", ([url, filters, id]) => {
    const relay = pool.relay(url);
    return relay.count(filters, id);
  });

  server.register("relayEvent", ([url, event]) => {
    const relay = pool.relay(url);
    return relay.event(event);
  });

  server.register("relayAuth", async ([url, event]) => {
    const relay = pool.relay(url);
    return await relay.auth(event);
  });

  server.register("relayNegentropy", async ([url, store, filter, reconcile, opts]) => {
    const relay = pool.relay(url);
    return await relay.negentropy(store, filter, reconcile, opts);
  });

  server.register("relayAuthenticate", async ([url, signer]) => {
    const relay = pool.relay(url);
    return await relay.authenticate(signer);
  });

  server.register("relayPublish", async ([url, event, opts]) => {
    const relay = pool.relay(url);
    return await relay.publish(event, opts);
  });

  server.register("relayRequest", ([url, filters, opts]) => {
    const relay = pool.relay(url);
    return relay.request(filters, opts);
  });

  server.register("relaySubscription", ([url, filters, opts]) => {
    const relay = pool.relay(url);
    return relay.subscription(filters, opts);
  });

  server.register("relaySync", ([url, store, filter, direction]) => {
    const relay = pool.relay(url);
    return relay.sync(store, filter, direction);
  });

  server.register("relayGetInformation", async ([url]) => {
    const relay = pool.relay(url);
    return await relay.getInformation();
  });

  server.register("relayGetLimitations", async ([url]) => {
    const relay = pool.relay(url);
    return await relay.getLimitations();
  });

  server.register("relayGetSupported", async ([url]) => {
    const relay = pool.relay(url);
    return await relay.getSupported();
  });

  return server;
}
