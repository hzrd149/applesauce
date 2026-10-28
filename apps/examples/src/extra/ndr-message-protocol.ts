import type { EventStore } from "applesauce-core";
import { unixNow, type EventTemplate } from "applesauce-core/helpers";
import type { DmProtocolAdapter, DmProtocolMessage, DmProtocolSession } from "applesauce-extra/kehto";
import { createNdrTransport } from "applesauce-extra/kehto/services/dm/ndr";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import {
  AppKeys,
  NdrRuntime,
  createPersistentNostrOutbox,
  type NdrRuntimeState,
  type StorageAdapter,
} from "nostr-double-ratchet";
import {
  Observable,
  Subject,
  catchError,
  combineLatest,
  defer,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
} from "rxjs";

import type SecureStorage from "./encrypted-storage";

/** The NDR adapter session and setup state */
export type NdrView = {
  phase: "disabled" | "login" | "starting" | "register" | "ready" | "error";
  state?: NdrRuntimeState;
  session?: DmProtocolSession;
  error?: string;
  run?: (action: "register" | "invite") => Promise<void>;
};
// A relay change can replace a runtime before its async initialization has finished closing.
const ndrShutdowns = new Map<string, Promise<void>>();

type NdrProtocolOptions = {
  pool: RelayPool;
  eventStore: EventStore;
  enabled$: Observable<boolean>;
  storage$: Observable<SecureStorage | null>;
  signer$: Observable<ISigner | undefined>;
  ownerPubkey$: Observable<string | undefined>;
  relays$: Observable<string[]>;
  approve: (template: EventTemplate, protocol: string, signal: AbortSignal) => Promise<boolean>;
  addLog: (direction: "out" | "error", message: string, detail?: string) => void;
};

/** Creates a persistent NDR protocol adapter and its setup state for the messaging example */
export function createNdrMessageProtocol({
  pool,
  eventStore,
  enabled$,
  storage$,
  signer$,
  ownerPubkey$,
  relays$,
  approve,
  addLog,
}: NdrProtocolOptions) {
  /** Keeps one encrypted, single-writer NDR runtime alive while its account and toggle are active */
  function ndrAccount$(secure: SecureStorage, signer: ISigner, ownerPubkey: string, relays: string[]) {
    return new Observable<NdrView>((subscriber) => {
      const previousShutdown = ndrShutdowns.get(ownerPubkey);
      let releaseShutdown!: () => void;
      const shutdown = new Promise<void>((resolve) => {
        releaseShutdown = resolve;
      });
      const lifetime = new AbortController();
      const assertActive = () => lifetime.signal.throwIfAborted();
      const database = secure.createInstance({ name: "napplet-messages-ndr", storeName: `account_${ownerPubkey}` });
      const writes = new Set<Promise<unknown>>();
      async function write<T>(operation: () => Promise<T>) {
        assertActive();
        const pending = operation();
        writes.add(pending);
        try {
          return await pending;
        } finally {
          writes.delete(pending);
        }
      }
      const storage: StorageAdapter = {
        get: async <T>(key: string) => {
          assertActive();
          const value = await database.getItem(key);
          assertActive();
          return value === null ? undefined : (JSON.parse(value) as T);
        },
        put: async (key, value) => {
          assertActive();
          if (!(await write(() => database.setItem(key, JSON.stringify(value)))))
            throw new Error("NDR encrypted storage write failed");
          assertActive();
        },
        del: async (key) => {
          await write(() => database.removeItem(key));
          assertActive();
        },
        list: async (prefix = "") => {
          assertActive();
          const keys = await database.keys();
          assertActive();
          return keys.filter((key) => key.startsWith(prefix));
        },
      };
      const transport = createNdrTransport(
        { pool, eventStore },
        {
          signer,
          ownerPubkey,
          relays,
          onSubscriptionError: (error) => report(error),
        },
      );
      const outbox = createPersistentNostrOutbox({
        storage,
        publish: transport.nostrPublish,
        onError: ({ error }) => report(error),
        onPublished: ({ innerEventId }) =>
          addLog("out", `ndr relay accepted${innerEventId ? ` ${innerEventId.slice(0, 8)}` : ""}`),
      });
      const runtime = new NdrRuntime({
        ...transport,
        storage,
        nostrEnqueue: outbox.enqueue,
        nostrPublish: outbox.publish,
        onPublishError: ({ error }) => report(error),
      });
      const messages = new Subject<DmProtocolMessage>();
      const commands = new Set<Promise<unknown>>();
      const sends = new Map<string, { signature: string; result: Promise<DmProtocolMessage> }>();
      let initialized = false;
      let lastError: string | undefined;
      let stop!: () => void;
      const stopped = new Promise<void>((resolve) => {
        stop = resolve;
      });

      function report(error: unknown) {
        if (lifetime.signal.aborted) return;
        lastError = String(error);
        addLog("error", "ndr", lastError);
        update();
      }

      async function saveMessage(message: DmProtocolMessage) {
        await storage.put(`messages/${message.id}`, message);
        assertActive();
        messages.next(message);
      }

      // The durable handler is attached before init, so ratchet advancement cannot lose a received chat on reload.
      const detachMessage = runtime.onDurableSessionEvent([14], async (event, from, meta) => {
        assertActive();
        const sender = meta?.senderOwnerPubkey ?? from;
        const peers =
          sender === ownerPubkey
            ? event.tags.filter((tag) => tag[0] === "p" && /^[0-9a-f]{64}$/.test(tag[1])).map((tag) => tag[1])
            : [sender];
        if (!peers.length) return;
        await saveMessage({
          id: event.id,
          content: event.content,
          createdAt: event.created_at,
          senderPubkey: sender,
          participants: [...new Set([ownerPubkey, ...peers])],
          status: sender === ownerPubkey ? "sent" : "received",
        });
      });

      const session: DmProtocolSession = {
        ownerPubkey,
        discover$: (request) =>
          defer(async () => {
            const canSend =
              initialized &&
              runtime.getState().canSendPrivateMessages &&
              request.recipients.length === 1 &&
              request.recipients[0] !== ownerPubkey;

            if (!canSend) return { canSend, support: "unknown" as const };

            const appKeys = await AppKeys.waitFor(request.recipients[0], transport.nostrSubscribe, 3000);
            assertActive();

            return {
              canSend,
              support: appKeys?.getAllDevices().length ? ("supported" as const) : ("unknown" as const),
            };
          }),
        messages$: ({ history }) =>
          history
            ? defer(async () => {
                const keys = await storage.list("messages/");
                const stored = await Promise.all(keys.map((key) => storage.get<DmProtocolMessage>(key)));
                return stored.filter((message): message is DmProtocolMessage => !!message);
              }).pipe(switchMap((stored) => of(...stored)))
            : messages,
        prepareSend$: (request, context) =>
          defer(async () => {
            assertActive();
            context.signal.throwIfAborted();
            const allowed = await approve(
              {
                kind: 14,
                content: request.content,
                created_at: unixNow(),
                tags: request.recipients.map((peer) => ["p", peer]),
              },
              "NDR",
              AbortSignal.any([context.signal, lifetime.signal]),
            );
            assertActive();
            context.signal.throwIfAborted();
            if (!allowed) throw new Error("User denied");
            return {
              publish$: defer(async () => {
                assertActive();
                context.signal.throwIfAborted();
                const key = request.clientMessageId && JSON.stringify([context.windowId, request.clientMessageId]);
                const signature = JSON.stringify([request.recipients, request.content]);
                const previous = key ? sends.get(key) : undefined;
                if (previous) {
                  if (previous.signature !== signature) throw new Error("NDR retry id belongs to another message");
                  return previous.result;
                }
                const result = (async () => {
                  const rumor = await runtime.sendMessage(request.recipients[0], request.content);
                  assertActive();
                  const message: DmProtocolMessage = {
                    id: rumor.id,
                    content: rumor.content,
                    createdAt: rumor.created_at,
                    senderPubkey: ownerPubkey,
                    participants: [ownerPubkey, ...request.recipients],
                    status: "sent",
                  };
                  // NDR's send result is a durable local handoff, not a relay or recipient acknowledgement.
                  await saveMessage(message);
                  addLog("out", "ndr submitted");
                  return message;
                })();
                if (key) {
                  sends.set(key, { signature, result });
                  if (sends.size > 100) sends.delete(sends.keys().next().value!);
                }
                return result;
              }),
            };
          }),
      };

      async function run(action: "register" | "invite") {
        const command = (async () => {
          assertActive();
          lastError = undefined;
          if (action === "register") await runtime.ensureCurrentDeviceRegistered(ownerPubkey);
          assertActive();
          await runtime.republishInvite();
          assertActive();
          addLog("out", "ndr invite submitted");
          update();
        })();
        commands.add(command);
        try {
          await command;
        } catch (error) {
          report(error);
          throw error;
        } finally {
          commands.delete(command);
        }
      }

      function update() {
        if (subscriber.closed) return;
        const state = runtime.getState();
        subscriber.next({
          phase: !initialized ? "starting" : state.canSendPrivateMessages ? "ready" : "register",
          state,
          session: initialized ? session : undefined,
          error: lastError,
          run: initialized ? run : undefined,
        });
      }

      const detachState = runtime.onStateChange(update);
      const retry = () => {
        void outbox.retry().catch(report);
      };

      function destroy() {
        if (lifetime.signal.aborted) return;
        lifetime.abort();
        stop();
        detachMessage();
        detachState();
        window.removeEventListener("online", retry);
        transport.dispose();
        runtime.close();
        void outbox.close().catch(() => {});
        messages.complete();
      }

      async function start() {
        try {
          await previousShutdown;
          assertActive();
          if (!navigator.locks) throw new Error("NDR requires Web Locks for safe persistent state ownership");
          await navigator.locks.request(`napplet-messages-ndr:${ownerPubkey}`, { ifAvailable: true }, async (lock) => {
            if (!lock) throw new Error("NDR for this account is open in another tab");
            try {
              assertActive();
              await runtime.initForOwner(ownerPubkey);
              assertActive();
              initialized = true;
              update();
              window.addEventListener("online", retry);
              retry();
              await stopped;
              await Promise.allSettled([...commands]);
            } finally {
              destroy();
              await outbox.close();
              await Promise.allSettled([...writes]);
            }
          });
        } catch (error) {
          destroy();
          if (!subscriber.closed) {
            addLog("error", "ndr startup", String(error));
            subscriber.next({ phase: "error", error: String(error) });
          }
        } finally {
          destroy();
          await outbox.close();
          await Promise.allSettled([...writes]);
          releaseShutdown();
          if (ndrShutdowns.get(ownerPubkey) === shutdown) ndrShutdowns.delete(ownerPubkey);
        }
      }
      ndrShutdowns.set(ownerPubkey, shutdown);
      void start();

      return destroy;
    });
  }

  const view$ = combineLatest([enabled$, storage$, signer$, ownerPubkey$, relays$]).pipe(
    switchMap(([enabled, storage, signer, ownerPubkey, relays]) => {
      if (!enabled) return of<NdrView>({ phase: "disabled" });
      if (!storage || !signer || !ownerPubkey) return of<NdrView>({ phase: "login" });
      return defer(async () => {
        if ((await signer.getPublicKey()) !== ownerPubkey) throw new Error("Waiting for the current account signer");
        return ownerPubkey;
      }).pipe(
        switchMap((ownerPubkey) => ndrAccount$(storage, signer, ownerPubkey, relays)),
        startWith<NdrView>({ phase: "starting" }),
        catchError((error) => of<NdrView>({ phase: "error", error: String(error) })),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  const protocol: DmProtocolAdapter = {
    id: "ndr",
    session$: view$.pipe(
      map((view) => view.session),
      distinctUntilChanged(),
    ),
  };

  return { protocol, view$ };
}
