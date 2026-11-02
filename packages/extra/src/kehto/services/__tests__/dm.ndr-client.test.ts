import { InMemoryStorageAdapter } from "nostr-double-ratchet";
import { BehaviorSubject, firstValueFrom, of, toArray } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NdrMessagesClient } from "../../../messages/ndr/client.js";
import { NdrHistory } from "../../../messages/ndr/history.js";
import type { NdrClientLifecycle } from "../../../messages/ndr/types.js";
import { createNdrMessageProtocol, createMultiProtocolDmAdapter, useProtocol } from "../dm.js";

const alice = "a".repeat(64);
const bob = "b".repeat(64);
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((close) => close()));

function fixture() {
  const history = new NdrHistory(new InMemoryStorageAdapter());
  const lifecycle$ = new BehaviorSubject<NdrClientLifecycle>("ready");
  const peerDevices$ = new BehaviorSubject<unknown[] | undefined>([{}]);
  let sequence = 0;
  const send = vi.fn(async (conversationId: string, content: string) => {
    const message = {
      id: `sent-${++sequence}`,
      conversationId,
      content,
      sender: alice,
      createdAt: 100,
      delivery: "queued" as const,
    };
    await history.addMessage(message);
    return { ...message, reactions: {} };
  });
  const source = {
    pubkey: alice,
    history,
    lifecycle$,
    state$: of({ canSendPrivateMessages: true }),
    conversation: (peer: string) => ({
      id: peer,
      peerDevices$,
      send: ({ content }: { content: string }) => send(peer, content),
    }),
    group: (id: string) => ({
      id: `group:${id}`,
      canSend$: of(true),
      send: ({ content }: { content: string }) => send(`group:${id}`, content),
    }),
    start: vi.fn(),
    dispose: vi.fn(),
  };
  const client = source as unknown as NdrMessagesClient;
  return { client, source, send, history, lifecycle$, peerDevices$ };
}

function compose(
  client: NdrMessagesClient | BehaviorSubject<NdrMessagesClient | undefined>,
  approve = vi.fn(async () => true),
) {
  const protocol = createNdrMessageProtocol({ client, approve, discoveryTimeout: 5 });
  const dm = createMultiProtocolDmAdapter({
    protocols: [protocol],
    routeSend: useProtocol("ndr"),
    getWindowId: () => "window",
  });
  cleanup.push(() => dm.close?.());
  return { protocol, dm, approve };
}

describe("NDR messages client protocol", () => {
  it("uses ready host clients without starting or disposing them", async () => {
    const { client, source, lifecycle$ } = fixture();
    lifecycle$.next("starting");
    const { dm } = compose(client);
    expect((await dm.status()).available).toBe(false);
    lifecycle$.next("ready");
    expect((await dm.status()).ownerPubkey).toBe(alice);
    lifecycle$.next("disposed");
    expect((await dm.status()).available).toBe(false);
    dm.close?.();
    expect(source.start).not.toHaveBeenCalled();
    expect(source.dispose).not.toHaveBeenCalled();
  });

  it("reads stored history and forwards new messages and receipt updates once", async () => {
    const { client, history } = fixture();
    await history.addMessage({
      id: "old",
      conversationId: bob,
      content: "old",
      sender: alice,
      createdAt: 100,
      delivery: "queued",
    });
    const { dm } = compose(client);
    const conversation = (await dm.conversations()).conversations[0];
    expect((await dm.messages({ conversationId: conversation.id })).messages[0].id).toBe("ndr:old");
    const onMessage = vi.fn();
    await dm.subscribe({}, onMessage);
    await history.advanceDelivery("old", "published");
    await history.addReceipt(bob, ["old"], "delivered");
    await history.addMessage({
      id: "new",
      conversationId: bob,
      content: "new",
      sender: bob,
      createdAt: 101,
      delivery: "received",
    });
    expect(onMessage.mock.calls.map(([message]) => [message.id, message.status])).toEqual([
      ["ndr:old", "sent"],
      ["ndr:old", "delivered"],
      ["ndr:new", "received"],
    ]);
  });

  it("waits for device discovery and bounds unknown support", async () => {
    const { client, peerDevices$ } = fixture();
    const { protocol } = compose(client);
    const session = (await firstValueFrom(protocol.session$))!;
    const context = { signal: new AbortController().signal };
    peerDevices$.next(undefined);
    const discovery = firstValueFrom(session.discover$({ recipients: [bob], content: "hi" }, context));
    peerDevices$.next([{}]);
    expect(await discovery).toEqual({ canSend: true, support: "supported" });
    peerDevices$.next(undefined);
    expect(await firstValueFrom(session.discover$({ recipients: [bob], content: "hi" }, context))).toEqual({
      canSend: true,
      support: "unknown",
    });
    expect(
      await firstValueFrom(session.discover$({ recipients: [bob, "c".repeat(64)], content: "hi" }, context)),
    ).toEqual({ canSend: false, support: "unknown" });
  });

  it("approves before sending and retains window-scoped retry results", async () => {
    const { client, send } = fixture();
    const { dm, approve } = compose(client);
    const request = { recipients: [bob], content: "hello", clientMessageId: "retry" };
    const first = await dm.send(request);
    expect(await dm.send(request)).toEqual(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ windowId: "window", template: expect.objectContaining({ content: "hello" }) }),
    );
    expect(approve).toHaveBeenCalledTimes(1);
    await expect(dm.send({ ...request, content: "changed" })).rejects.toThrow("clientMessageId");
  });

  it("keeps sending cold until publication and rejects denied approval", async () => {
    const { client, send } = fixture();
    const { protocol } = compose(client);
    const session = (await firstValueFrom(protocol.session$))!;
    const controller = new AbortController();
    const prepared = await firstValueFrom(
      session.prepareSend$({ recipients: [bob], content: "hello" }, { signal: controller.signal }),
    );
    expect(send).not.toHaveBeenCalled();
    controller.abort();
    await expect(firstValueFrom(prepared.publish$)).rejects.toThrow();
    const denied = compose(
      client,
      vi.fn(async () => false),
    );
    await expect(denied.dm.send({ recipients: [bob], content: "no" })).rejects.toThrow("User denied");
    expect(send).not.toHaveBeenCalled();
  });

  it("cancels pending approval when the active client is replaced", async () => {
    const { client, send } = fixture();
    const clients$ = new BehaviorSubject<NdrMessagesClient | undefined>(client);
    let resolve!: (value: boolean) => void;
    const approve = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const { dm } = compose(clients$, approve);
    const sending = dm.send({ recipients: [bob], content: "old account" });
    const rejected = expect(sending).rejects.toThrow("Account changed");
    await vi.waitFor(() => expect(approve).toHaveBeenCalled());
    clients$.next(fixture().client);
    resolve(true);
    await rejected;
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves group identities and routes sends through the client group", async () => {
    const { client, history, send } = fixture();
    for (const id of ["one", "two"]) {
      await history.putGroup({
        data: { id, name: id, members: [alice, bob], admins: [alice], createdAt: 100 },
        revision: 1,
        createdBy: alice,
      });
      await history.addMessage({
        id: "same",
        conversationId: `group:${id}`,
        content: id,
        sender: bob,
        createdAt: 100,
        delivery: "received",
      });
    }
    const { dm, protocol } = compose(client);
    const conversations = (await dm.conversations()).conversations;
    expect(conversations.map((conversation) => conversation.id).sort()).toEqual([
      "group:ndr:group%3Aone",
      "group:ndr:group%3Atwo",
    ]);
    const result = await dm.send({
      recipients: [bob],
      content: "group reply",
      conversationId: "group:ndr:group%3Atwo",
    });
    expect(result.message.conversationId).toBe("group:ndr:group%3Atwo");
    expect(send).toHaveBeenCalledWith("group:two", "group reply");
    await expect(
      dm.send({ recipients: ["c".repeat(64)], content: "wrong", conversationId: "group:ndr:group%3Atwo" }),
    ).rejects.toThrow("Ineligible");
    const session = (await firstValueFrom(protocol.session$))!;
    const messages = await firstValueFrom(
      session.messages$({ history: true, signal: new AbortController().signal }).pipe(toArray()),
    );
    expect(messages).toHaveLength(3);
  });

  it("rechecks group membership after approval before dispatch", async () => {
    const { client, history, send } = fixture();
    const data = { id: "team", name: "Team", members: [alice, bob], admins: [alice], createdAt: 100 };
    await history.putGroup({ data, revision: 1, createdBy: alice });
    const { protocol } = compose(client);
    const session = (await firstValueFrom(protocol.session$))!;
    const prepared = await firstValueFrom(
      session.prepareSend$(
        {
          conversationId: "group:team",
          recipients: [bob],
          content: "approved for Bob",
        },
        { signal: new AbortController().signal },
      ),
    );
    await history.putGroup({ data: { ...data, members: [alice, bob, "c".repeat(64)] }, revision: 2, createdBy: alice });
    await expect(firstValueFrom(prepared.publish$)).rejects.toThrow("does not match recipients");
    expect(send).not.toHaveBeenCalled();
  });
});
