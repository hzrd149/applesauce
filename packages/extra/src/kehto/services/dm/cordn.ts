import { Client } from "@contextvm/mcp-sdk/client";
import { EncryptionMode, GiftWrapMode, type NostrSigner, type RelayHandler } from "@contextvm/sdk/core";
import { PrivateKeySigner } from "@contextvm/sdk";
import { NostrClientTransport } from "@contextvm/sdk/transport";
import { getEventHash, mergeRelaySets, verifyEvent, type NostrEvent } from "applesauce-core/helpers";
import type { ISigner } from "applesauce-signers";
import {
  defer,
  distinct,
  filter,
  firstValueFrom,
  merge,
  mergeMap,
  ReplaySubject,
  Subscription,
  takeUntil,
  throwError,
  timeout,
} from "rxjs";
import type { KehtoPoolContext } from "../../foundation/pool.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isKeyPackageSummary(value: unknown): value is { pk: string; kp_ref: string } {
  return (
    isRecord(value) &&
    typeof value.pk === "string" &&
    /^[0-9a-f]{64}$/.test(value.pk) &&
    typeof value.kp_ref === "string"
  );
}

function isWelcome(value: unknown): value is CordnWelcome {
  return (
    isRecord(value) &&
    typeof value.kp_ref === "string" &&
    typeof value.welcome_64 === "string" &&
    Number.isSafeInteger(value.at) &&
    (value.after === undefined || Number.isSafeInteger(value.after))
  );
}

function isGroupMessage(value: unknown): value is CordnGroupMessage {
  return (
    isRecord(value) &&
    typeof value.gid === "string" &&
    typeof value.msg_64 === "string" &&
    Number.isSafeInteger(value.cursor) &&
    Number.isSafeInteger(value.at)
  );
}

/** Options for an account-bound Cordn coordinator connection */
export interface KehtoCordnCoordinatorOptions {
  /** The coordinator's hex public key */
  coordinatorPubkey: string;
  /** The explicit operational relays */
  relays: string[];
  /** The account identity used for key packages and welcome retrieval */
  ownerPubkey: string;
  /** The account-bound signer, including NIP-44 support */
  signer: ISigner;
  /** The connection and per-request deadline in milliseconds (default 12000) */
  timeoutMs?: number;
}

/** An opaque MLS message stored by a Cordn coordinator */
export interface CordnGroupMessage {
  /** The coordinator-assigned message cursor */
  cursor: number;
  /** The MLS group id */
  gid: string;
  /** The base64-encoded encrypted group payload */
  msg_64: string;
  /** The coordinator timestamp */
  at: number;
}

/** A pending welcome that must be acknowledged only after durable MLS processing */
export interface CordnWelcome {
  /** The matching local key-package reference */
  kp_ref: string;
  /** The base64-encoded MLS welcome */
  welcome_64: string;
  /** The coordinator timestamp used for acknowledgement */
  at: number;
  /** The message cursor preceding the new member's history */
  after?: number;
}

/** A Cordn key-package publication with the original signed ContextVM request */
export interface CordnKeyPackage {
  /** The publishing account's public key */
  pk: string;
  /** The MLS key-package reference */
  kp_ref: string;
  /** The signed publication event that must be verified before accepting its key package */
  event: unknown;
}

/** A signer-backed coordinator client; it does not own MLS state or expose a DM session */
export interface KehtoCordnCoordinator {
  /** Lists available key packages without consuming them or authenticating as the account */
  listKeyPackages(): Promise<{ pk: string; kp_ref: string }[]>;
  /** Publishes an MLS key package as the account identity */
  publishKeyPackage(reference: string, keyPackageBase64: string): Promise<void>;
  /** Fetches pending welcomes as the account, acknowledging only explicitly consumed entries */
  fetchWelcomes(consumed?: { kp_ref: string; at: number }[]): Promise<CordnWelcome[]>;
  /** Consumes a recipient's key package using an ephemeral caller identity */
  consumeKeyPackage(identifier: string): Promise<CordnKeyPackage | null>;
  /** Stores a welcome using an ephemeral caller identity */
  storeWelcome(targetPubkey: string, reference: string, welcomeBase64: string, after?: number): Promise<void>;
  /** Posts an encrypted MLS payload without claiming recipient delivery */
  postMessage(groupId: string, messageBase64: string): Promise<{ cursor: number; gid: string; at: number }>;
  /** Fetches encrypted messages after each group's independently persisted cursor */
  fetchMessages(groups: { gid: string; after?: number }[]): Promise<CordnGroupMessage[]>;
  /** Aborts requests and closes owned subscriptions without disconnecting the shared pool */
  close(): Promise<void>;
}

/**
 * Creates isolated stable and ephemeral ContextVM clients for Cordn's coordinator contract
 * @throws if identities, relays, timeout, or NIP-44 support are invalid
 * @see https://github.com/Cordn-msg/cordn/blob/master/packages/core/src/contracts.ts
 */
export function createCordnCoordinator(
  context: KehtoPoolContext,
  options: KehtoCordnCoordinatorOptions,
): KehtoCordnCoordinator {
  const relays = mergeRelaySets(options.relays);
  const timeoutMs = options.timeoutMs ?? 12000;
  if (![options.ownerPubkey, options.coordinatorPubkey].every((key) => /^[0-9a-f]{64}$/.test(key))) {
    throw new Error("Cordn requires hex account and coordinator public keys");
  }
  if (!relays.length || relays.some((relay) => !/^wss?:\/\//.test(relay))) {
    throw new Error("Cordn requires explicit WebSocket relays");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid Cordn timeout");
  if (!options.signer.nip44) throw new Error("Cordn account signer requires NIP-44");

  const lifecycle = new AbortController();
  const closed$ = new ReplaySubject<void>(1);
  const cancelled$ = closed$.pipe(mergeMap(() => throwError(() => new Error("Cordn coordinator closed"))));
  const subscriptions = new Subscription();
  let closing: Promise<void> | undefined;

  function assertActive() {
    lifecycle.signal.throwIfAborted();
  }

  // Keep the captured account binding even when an application supplies a proxy signer.
  async function assertOwner() {
    assertActive();
    if ((await options.signer.getPublicKey()) !== options.ownerPubkey) throw new Error("Cordn owner signer mismatch");
    assertActive();
  }

  const signer: NostrSigner = {
    getPublicKey: async () => {
      await assertOwner();
      return options.ownerPubkey;
    },
    signEvent: async (template) => {
      await assertOwner();
      const signed = await options.signer.signEvent(template);
      await assertOwner();
      if (
        signed.pubkey !== options.ownerPubkey ||
        signed.id !== getEventHash({ ...template, pubkey: options.ownerPubkey }) ||
        !isVerified(signed)
      )
        throw new Error("Cordn signer changed the account event");
      return signed;
    },
    nip44: {
      encrypt: async (pubkey, plaintext) => {
        await assertOwner();
        const ciphertext = await options.signer.nip44!.encrypt(pubkey, plaintext);
        await assertOwner();
        return ciphertext;
      },
      decrypt: async (pubkey, ciphertext) => {
        await assertOwner();
        const plaintext = await options.signer.nip44!.decrypt(pubkey, ciphertext);
        await assertOwner();
        return plaintext;
      },
    },
  };

  function isVerified(event: NostrEvent): boolean {
    // Verify a fresh object: the example store may use optimistic verification.
    const { id, pubkey, kind, created_at, tags, content, sig } = event;
    return typeof sig === "string" && verifyEvent({ id, pubkey, kind, created_at, tags, content, sig });
  }

  function connection(identity: NostrSigner) {
    const owned = new Subscription();
    subscriptions.add(owned);
    const relayHandler: RelayHandler = {
      connect: async () => assertActive(),
      disconnect: async () => owned.unsubscribe(),
      unsubscribe: () => owned.unsubscribe(),
      getRelayUrls: () => [...relays],
      publish: async (event, request) => {
        assertActive();
        request?.abortSignal?.throwIfAborted();
        if (!isVerified(event)) throw new Error("Invalid Cordn transport event");
        const results = await context.pool.publish(relays, event);
        assertActive();
        if (!results.some((result) => result.ok))
          throw new Error(results[0]?.message ?? "No relay accepted Cordn event");
        context.eventStore.add(event);
      },
      subscribe: async (filters, onEvent) => {
        assertActive();
        const network = context.pool.subscription(relays, filters, { reconnect: true }).pipe(filter(isVerified));
        const subscription = merge(context.eventStore.filters(filters), network)
          .pipe(
            filter(isVerified),
            distinct((event) => event.id),
          )
          .subscribe({
            next: (event) => {
              context.eventStore.add(event);
              onEvent(event);
            },
            error: (error) => transport.onerror?.(error instanceof Error ? error : new Error(String(error))),
          });
        owned.add(subscription);
        return () => subscription.unsubscribe();
      },
    };
    const transport = new NostrClientTransport({
      signer: identity,
      relayHandler,
      serverPubkey: options.coordinatorPubkey,
      encryptionMode: EncryptionMode.REQUIRED,
      giftWrapMode: GiftWrapMode.EPHEMERAL,
      isStateless: true,
      oversizedTransfer: { enabled: true },
      // Failures propagate through the client API rather than SDK console logging.
      logLevel: "silent",
    });
    const client = new Client({ name: "applesauce-cordn", version: "1.0.0" });
    let connected: Promise<void> | undefined;

    return {
      client,
      transport,
      async connect() {
        assertActive();
        connected ??= client.connect(transport, { timeout: timeoutMs, signal: lifecycle.signal });
        try {
          await connected;
          assertActive();
        } catch (error) {
          connected = undefined;
          throw error;
        }
      },
    };
  }

  const stable = connection(signer);
  const ephemeral = connection(new PrivateKeySigner());

  async function request(target: typeof stable, name: string, args: Record<string, unknown>) {
    await target.connect();
    const response = await target.client.callTool({ name, arguments: args }, undefined, {
      timeout: timeoutMs,
      signal: lifecycle.signal,
    });
    assertActive();
    if (response.isError) {
      const detail = Array.isArray(response.content)
        ? response.content
            .map((part: unknown) =>
              isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "",
            )
            .filter(Boolean)
            .join("\n")
        : "";
      throw new Error(detail || `Cordn coordinator rejected ${name}`);
    }
    const result = response.structuredContent;
    if (!isRecord(result)) throw new Error(`Invalid Cordn ${name} response`);
    return result;
  }

  function close(): Promise<void> {
    if (closing) return closing;
    lifecycle.abort(new Error("Cordn coordinator closed"));
    closed$.next();
    closed$.complete();
    subscriptions.unsubscribe();
    closing = Promise.allSettled([
      stable.client.close(),
      ephemeral.client.close(),
      stable.transport.close(),
      ephemeral.transport.close(),
    ]).then(() => {});
    return closing;
  }

  async function call(target: typeof stable, name: string, args: Record<string, unknown>) {
    try {
      // Include signer prompts and transport startup, not just the MCP response wait.
      return await firstValueFrom(
        defer(() => request(target, name, args)).pipe(timeout(timeoutMs), takeUntil(cancelled$)),
      );
    } catch (error) {
      // A failed connection is terminal: delayed signer results must not publish afterward.
      void close();
      throw error;
    }
  }

  return {
    listKeyPackages: async () => {
      const result = await call(ephemeral, "kp_list", {});
      if (!Array.isArray(result.keyPackages) || !result.keyPackages.every(isKeyPackageSummary))
        throw new Error("Invalid Cordn key-package listing");
      return result.keyPackages;
    },
    publishKeyPackage: async (reference, keyPackageBase64) => {
      await call(stable, "kp_publish", { kp_ref: reference, kp_64: keyPackageBase64 });
    },
    fetchWelcomes: async (consumed) => {
      const result = await call(stable, "welcome_take", { ...(consumed?.length ? { consumed } : {}) });
      if (!Array.isArray(result.welcomes) || !result.welcomes.every(isWelcome))
        throw new Error("Invalid Cordn welcomes");
      return result.welcomes;
    },
    consumeKeyPackage: async (identifier) => {
      const result = await call(ephemeral, "kp_take", { id: identifier });
      if (result.keyPackage === null) return null;
      const item = result.keyPackage;
      if (!isRecord(item) || !item.event) throw new Error("Invalid Cordn key package");
      const publicationEvent = item.event;
      if (!isKeyPackageSummary(item)) {
        throw new Error("Invalid Cordn key package");
      }
      return { pk: item.pk, kp_ref: item.kp_ref, event: publicationEvent };
    },
    storeWelcome: async (targetPubkey, reference, welcomeBase64, after) => {
      await call(ephemeral, "welcome_store", {
        target_pk: targetPubkey,
        kp_ref: reference,
        welcome_64: welcomeBase64,
        ...(after !== undefined ? { after } : {}),
      });
    },
    postMessage: async (groupId, messageBase64) => {
      const result = await call(ephemeral, "msg_post", { gid: groupId, msg_64: messageBase64 });
      if (
        result.gid !== groupId ||
        typeof result.cursor !== "number" ||
        !Number.isSafeInteger(result.cursor) ||
        typeof result.at !== "number" ||
        !Number.isSafeInteger(result.at)
      ) {
        throw new Error("Invalid Cordn message acknowledgement");
      }
      return { cursor: result.cursor, gid: groupId, at: result.at };
    },
    fetchMessages: async (groups) => {
      const result = await call(ephemeral, "msg_fetch_many", { groups });
      if (
        !Array.isArray(result.messages) ||
        !result.messages.every(isGroupMessage) ||
        !result.messages.every((message) => groups.some((group) => group.gid === message.gid))
      )
        throw new Error("Invalid Cordn messages");
      return result.messages;
    },
    close,
  };
}
