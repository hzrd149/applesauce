import { LegacyMessageFactory } from "applesauce-common/factories";
import { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { InMemoryStorageAdapter } from "nostr-double-ratchet";
import { BehaviorSubject, EMPTY, filter, firstValueFrom, NEVER, toArray } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyMessagesClient } from "../../../messages/legacy/client.js";
import { NdrMessagesClient } from "../../../messages/ndr/client.js";
import {
  createLegacyMessageProtocol,
  createNdrMessageProtocol,
  createMultiProtocolDmAdapter,
  useProtocol,
} from "../dm.js";

const signer = new PrivateKeySigner(new Uint8Array(32).fill(1));
const peerSigner = new PrivateKeySigner(new Uint8Array(32).fill(2));
const pubkey = await signer.getPublicKey();
const peer = await peerSigner.getPublicKey();
const cleanup: (() => void)[] = [];

afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close());
  vi.restoreAllMocks();
});

function options() {
  const pool = {
    subscription: vi.fn(() => NEVER),
    relay: () => ({ getSupported: async () => [], request: () => EMPTY }),
    publish: vi.fn(async (relays: string[]) => relays.map((from) => ({ from, ok: true }))),
  };
  return {
    pubkey,
    signer,
    eventStore: new EventStore(),
    pool: pool as unknown as RelayPool,
    fallbackRelays: ["wss://relay.test/"],
    timeout: 5,
  };
}

describe("protocol client ownership", () => {
  it.each(["legacy", "ndr"] as const)("shares and disposes an owned %s client", async (kind) => {
    const start =
      kind === "legacy"
        ? vi.spyOn(LegacyMessagesClient.prototype, "start").mockResolvedValue()
        : vi.spyOn(NdrMessagesClient.prototype, "start").mockResolvedValue();
    const protocol =
      kind === "legacy"
        ? createLegacyMessageProtocol({ clientOptions: options() })
        : createNdrMessageProtocol({
            clientOptions: {
              ...options(),
              storage: new InMemoryStorageAdapter(),
              relays: ["wss://relay.test/"],
              lockName: false,
            },
          });
    cleanup.push(() => protocol.close?.());
    expect(start).not.toHaveBeenCalled();

    const clients: (LegacyMessagesClient | NdrMessagesClient | undefined)[] = [];
    const observer = protocol.client$.subscribe((client) => clients.push(client));
    const sessions = protocol.session$.subscribe();
    cleanup.push(
      () => observer.unsubscribe(),
      () => sessions.unsubscribe(),
    );
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const client = clients[0]!;
    const dispose = vi.spyOn(client, "dispose");
    observer.unsubscribe();
    sessions.unsubscribe();
    expect(dispose).not.toHaveBeenCalled();

    protocol.close?.();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(await firstValueFrom(protocol.client$)).toBeUndefined();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it.each(["legacy", "ndr"] as const)("disposes an owned %s client when startup fails", async (kind) => {
    const failure = new Error("startup failed");
    if (kind === "legacy") vi.spyOn(LegacyMessagesClient.prototype, "start").mockRejectedValue(failure);
    else vi.spyOn(NdrMessagesClient.prototype, "start").mockRejectedValue(failure);
    const protocol =
      kind === "legacy"
        ? createLegacyMessageProtocol({ clientOptions: options() })
        : createNdrMessageProtocol({
            clientOptions: {
              ...options(),
              storage: new InMemoryStorageAdapter(),
              relays: ["wss://relay.test/"],
              lockName: false,
            },
          });
    cleanup.push(() => protocol.close?.());
    let dispose: ReturnType<typeof vi.spyOn>;
    const error = vi.fn();
    protocol.client$.subscribe({
      next: (client) => {
        if (client) dispose = vi.spyOn(client, "dispose");
      },
      error,
    });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(failure));
    expect(dispose!).toHaveBeenCalledTimes(1);
  });

  it("never starts or disposes a borrowed legacy client and resets sessions on restart", async () => {
    const client = new LegacyMessagesClient(options());
    cleanup.push(() => client.dispose());
    await client.start();
    const start = vi.spyOn(client, "start");
    const dispose = vi.spyOn(client, "dispose");
    const stop = vi.spyOn(client, "stop");
    const protocol = createLegacyMessageProtocol({ client });
    const dm = createMultiProtocolDmAdapter({ protocols: [protocol] });
    cleanup.push(() => dm.close?.());
    const sessions: unknown[] = [];
    const subscription = protocol.session$.subscribe((session) => sessions.push(session));
    cleanup.push(() => subscription.unsubscribe());
    expect((await dm.status()).available).toBe(true);
    expect(start).not.toHaveBeenCalled();
    client.stop();
    expect((await dm.status()).available).toBe(false);
    await client.start();
    expect((await dm.status()).available).toBe(true);
    expect(sessions[2]).not.toBe(sessions[0]);
    dm.close?.();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("observes host unlocks without prompting the signer during reads", async () => {
    const client = new LegacyMessagesClient(options());
    cleanup.push(() => client.dispose());
    const message = JSON.parse(JSON.stringify(await LegacyMessageFactory.create(pubkey, "private").sign(peerSigner)));
    client.eventStore.add(message);
    await client.start();
    vi.spyOn(client, "loadHistory").mockResolvedValue({ mailboxes: [], done: true, loaded: 0 });
    const decrypt = vi.spyOn(signer.nip04, "decrypt");
    const protocol = createLegacyMessageProtocol({ client });
    cleanup.push(() => protocol.close?.());
    const session = (await firstValueFrom(protocol.session$))!;
    const controller = new AbortController();
    const messages: unknown[] = [];
    const live = session
      .messages$({ signal: controller.signal, history: false })
      .subscribe((message) => messages.push(message));
    cleanup.push(() => live.unsubscribe());
    const history = await firstValueFrom(
      session.messages$({ signal: controller.signal, history: true }).pipe(toArray()),
    );
    expect(history).toEqual([]);
    expect(decrypt).not.toHaveBeenCalled();
    await client.unlock(message);
    expect(messages).toEqual([expect.objectContaining({ id: message.id, content: "private", status: "received" })]);
    controller.abort();
    expect(live.closed).toBe(true);
  });

  it.each(["borrowed", "owned"] as const)("retains approved signed sends with a %s client", async (ownership) => {
    const borrowed = ownership === "borrowed" ? new LegacyMessagesClient(options()) : undefined;
    if (borrowed) {
      cleanup.push(() => borrowed.dispose());
      await borrowed.start();
    }
    const approve = vi.fn(async () => true);
    const protocol = borrowed
      ? createLegacyMessageProtocol({ client: borrowed, approve })
      : createLegacyMessageProtocol({ clientOptions: options(), approve });
    cleanup.push(() => protocol.close?.());
    await firstValueFrom(protocol.session$.pipe(filter((session) => session !== undefined)));
    const client = (await firstValueFrom(protocol.client$))!;
    const dm = createMultiProtocolDmAdapter({ protocols: [protocol], routeSend: useProtocol("nip04") });
    cleanup.push(() => dm.close?.());
    const prepare = vi.spyOn(client, "prepareSend");
    const request = { recipients: [peer], content: "hello", clientMessageId: "retry" };
    const first = await dm.send(request);
    expect(await dm.send(request)).toEqual(first);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("keeps read-only clients ineligible for sending", async () => {
    const protocol = createLegacyMessageProtocol({ clientOptions: { ...options(), signer: undefined } });
    cleanup.push(() => protocol.close?.());
    const session = await firstValueFrom(protocol.session$.pipe(filter((session) => session !== undefined)));
    const availability = await firstValueFrom(
      session.discover$(
        { recipients: [peer], content: "hello" },
        {
          signal: new AbortController().signal,
        },
      ),
    );
    expect(availability.canSend).toBe(false);
  });

  it("invalidates pending approval when the borrowed client changes", async () => {
    const client = new LegacyMessagesClient(options());
    cleanup.push(() => client.dispose());
    await client.start();
    const clients = new BehaviorSubject<LegacyMessagesClient | undefined>(client);
    let resolve!: (approved: boolean) => void;
    const approve = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const protocol = createLegacyMessageProtocol({ client: clients, approve });
    const dm = createMultiProtocolDmAdapter({ protocols: [protocol], routeSend: useProtocol("nip04") });
    cleanup.push(() => dm.close?.());
    const prepare = vi.spyOn(client, "prepareSend");
    const sending = dm.send({ recipients: [peer], content: "pending" });
    const rejected = expect(sending).rejects.toThrow("Account changed");
    await vi.waitFor(() => expect(approve).toHaveBeenCalled());
    clients.next(undefined);
    resolve(true);
    await rejected;
    expect(prepare).not.toHaveBeenCalled();
  });
});
