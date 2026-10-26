import {
  createNdrDmAdapter,
  DmMemoryStore,
  type DmAdapter,
  type DmConversation,
  type DmMessage,
} from "@kehto/services";
import { BehaviorSubject, of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDmAdapterProtocol,
  createMultiProtocolDmAdapter,
  firstMatchingRoute,
  useProtocol,
  useProtocolWhenSupported,
  type KehtoDmOptions,
} from "../dm.js";

const alice = "a".repeat(64);
const bob = "b".repeat(64);
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
});

function upstream() {
  const store = new DmMemoryStore();
  const adapter: DmAdapter = {
    status: () => ({
      available: true,
      ownerPubkey: alice,
      implementations: ["upstream"],
      capabilities: ["send", "history", "subscribe"],
    }),
    conversations: (query) => store.conversations(query),
    messages: (query) => store.messages(query),
    send: vi.fn(async (request) => {
      const participants = [alice, ...request.recipients];
      const message = store.upsertMessage(
        {
          id: "native-sent",
          conversationId: request.conversationId ?? store.conversationIdFor(participants),
          createdAt: 100,
          content: request.content,
          senderPubkey: alice,
          status: "sent",
        },
        participants,
      );
      return { ok: true, message };
    }),
    subscribe: vi.fn(() => ({ subscriptionId: "native-live" })),
    unsubscribe: vi.fn(() => ({ ok: true })),
    close: vi.fn(),
  };
  return { adapter, store };
}

function compose(config: KehtoDmOptions) {
  const adapter = createMultiProtocolDmAdapter({ routingTimeout: 100, ...config });
  cleanup.push(() => adapter.close?.());
  return adapter;
}

describe("existing Kehto DM adapter interoperability", () => {
  it("composes the actual prebuilt NDR adapter and routes on supplied discovery", async () => {
    let incoming: ((event: { id: string; content: string }, from: string) => void) | undefined;
    const detach = vi.fn();
    const runtime = {
      setupUser: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => ({ id: "ndr-sent", created_at: 100 })),
      onSessionEvent: vi.fn((callback) => {
        incoming = callback;
        return detach;
      }),
      close: vi.fn(),
    };
    const native = createNdrDmAdapter({ runtime, ownerPubkey: alice });
    const protocol = createDmAdapterProtocol({
      id: "ndr",
      adapter: native,
      discover$: () => of({ canSend: true, support: "supported" }),
    });
    const dm = compose({ protocols: [protocol], routeSend: firstMatchingRoute(useProtocolWhenSupported("ndr")) });
    incoming?.({ id: "ndr-received", content: "incoming" }, bob);
    const conversation = (await dm.conversations()).conversations[0];
    expect((await dm.messages({ conversationId: conversation.id })).messages[0].content).toBe("incoming");
    const sent = await dm.send({ recipients: [bob], content: "reply", conversationId: conversation.id });
    expect(sent.message.id).toBe("ndr:ndr-sent");
    expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
    dm.close?.();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("preserves separate native groups with identical participants and translates send ids", async () => {
    const { adapter } = upstream();
    const groups: DmConversation[] = ["group:one", "group:two"].map((id) => ({
      id,
      kind: "group",
      participants: [{ pubkey: alice }, { pubkey: bob }],
      unread: 0,
    }));
    adapter.conversations = () => ({ conversations: groups });
    adapter.messages = ({ conversationId }) => ({
      messages: [
        {
          id: "same-native-id",
          conversationId,
          senderPubkey: bob,
          content: conversationId,
          createdAt: 10,
          status: "received",
        },
      ],
    });
    const protocol = createDmAdapterProtocol({ id: "cordn", adapter, supportsGroups: true });
    const dm = compose({ protocols: [protocol], routeSend: useProtocol("cordn") });
    const conversations = (await dm.conversations()).conversations;
    expect(conversations).toHaveLength(2);
    expect(conversations.map((entry) => entry.id)).toEqual(["group:cordn:group%3Aone", "group:cordn:group%3Atwo"]);
    const result = await dm.send({ recipients: [bob], conversationId: conversations[1].id, content: "reply" });
    expect(adapter.send).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "group:two" }));
    expect(result.message.conversationId).toBe(conversations[1].id);
  });

  it("loads every upstream conversation and message page", async () => {
    const { adapter } = upstream();
    const conversationId = "native-direct";
    const conversation: DmConversation = {
      id: conversationId,
      kind: "direct",
      participants: [{ pubkey: alice }, { pubkey: bob }],
      unread: 0,
    };
    adapter.conversations = vi.fn(({ cursor } = {}) =>
      cursor ? { conversations: [conversation] } : { conversations: [], cursor: "next" },
    );
    adapter.messages = vi.fn(({ cursor }) => ({
      messages: [
        {
          id: cursor ?? "first",
          conversationId,
          createdAt: cursor ? 20 : 10,
          senderPubkey: bob,
          content: "hello",
          status: "received",
        },
      ],
      ...(cursor ? {} : { cursor: "second" }),
    }));
    const dm = compose({ protocols: [createDmAdapterProtocol({ id: "existing", adapter })] });
    const conversationPage = await dm.conversations();
    const page = await dm.messages({ conversationId: conversationPage.conversations[0].id });
    expect(page.messages).toHaveLength(2);
    expect(adapter.messages).toHaveBeenCalledWith({ conversationId, cursor: "second" });
  });

  it("rejects cursor cycles instead of looping indefinitely", async () => {
    const { adapter } = upstream();
    adapter.conversations = () => ({ conversations: [], cursor: "same" });
    const dm = compose({ protocols: [createDmAdapterProtocol({ id: "existing", adapter })] });
    await expect(dm.conversations()).rejects.toThrow("repeated");
  });

  it("cleans up native subscriptions that resolve after the consumer unsubscribes", async () => {
    const { adapter } = upstream();
    let resolveSubscription!: (subscription: { subscriptionId: string }) => void;
    adapter.subscribe = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSubscription = resolve;
        }),
    );
    const dm = compose({ protocols: [createDmAdapterProtocol({ id: "existing", adapter })] });
    const live = await dm.subscribe({}, vi.fn());
    await vi.waitFor(() => expect(adapter.subscribe).toHaveBeenCalledTimes(1));
    await dm.unsubscribe(live.subscriptionId);
    resolveSubscription({ subscriptionId: "late-native-live" });
    await vi.waitFor(() => expect(adapter.unsubscribe).toHaveBeenCalledWith("late-native-live"));
  });

  it("invalidates pending native sends when a reactive adapter is removed", async () => {
    const { adapter } = upstream();
    const adapter$ = new BehaviorSubject<DmAdapter | undefined>(adapter);
    let finish!: (value: { ok: boolean; message: DmMessage }) => void;
    adapter.send = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const dm = compose({
      protocols: [createDmAdapterProtocol({ id: "existing", adapter: adapter$ })],
      routeSend: useProtocol("existing"),
    });
    const sending = dm.send({ recipients: [bob], content: "hello" });
    await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1));
    adapter$.next(undefined);
    await expect(sending).rejects.toThrow("Account changed");
    finish({
      ok: true,
      message: {
        id: "late",
        conversationId: "native",
        senderPubkey: alice,
        content: "hello",
        createdAt: 10,
        status: "sent",
      },
    });
    expect(adapter$.observed).toBe(false);
  });

  it("does not silently route group sends to a direct-only native adapter", async () => {
    const { adapter } = upstream();
    const dm = compose({
      protocols: [createDmAdapterProtocol({ id: "existing", adapter })],
      routeSend: useProtocol("existing"),
    });
    await expect(dm.send({ recipients: [bob, "c".repeat(64)], content: "group" })).rejects.toThrow("Ineligible");
    expect(adapter.send).not.toHaveBeenCalled();
  });
});
