import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, NEVER, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createCommonOptions } from "../kehto/services/common.js";

function setup() {
  const signer = new PrivateKeySigner(new Uint8Array(32).fill(1));
  const eventStore = new EventStore();
  const publish = vi.fn(async (relays: string[]) => relays.map(() => ({ ok: true })));
  const config = {
    signer,
    eventStore,
    pool: { publish } as unknown as RelayPool,
    fallbackRelays: ["wss://relay.example"],
    timeout: 10,
    actionTimeout: 100,
  };
  return { config, publish };
}

describe("common reliability", () => {
  it("bounds silent accounts and converts account errors into results", async () => {
    const { config } = setup();
    const silent = createCommonOptions({ ...config, account$: NEVER });
    expect(await silent.follow!(["a".repeat(64)], { windowId: "w" })).toMatchObject({ ok: false });
    expect(await silent.follows!({ windowId: "w" })).toMatchObject({ ok: false, pubkeys: [] });
    const failed = createCommonOptions({ ...config, account$: throwError(() => new Error("offline")) });
    expect(await failed.follow!(["a".repeat(64)], { windowId: "w" })).toMatchObject({
      ok: false,
      error: "offline",
    });
  });

  it("bounds fallback resolution and a stalled publish", async () => {
    const { config, publish } = setup();
    const common = createCommonOptions({ ...config, fallbackRelays: NEVER });
    expect(await common.follow!(["a".repeat(64)], { windowId: "w" })).toMatchObject({ ok: false });
    expect(publish).toHaveBeenCalledWith([], expect.any(Object));
    publish.mockImplementation(() => new Promise(() => {}));
    expect(await common.follow!(["a".repeat(64)], { windowId: "w" })).toMatchObject({ ok: false });
  });

  it("batches contacts and serializes concurrent updates with advancing timestamps", async () => {
    const { config, publish } = setup();
    const common = createCommonOptions(config);
    const first = await common.follow!(["a".repeat(64), "b".repeat(64)], { windowId: "w" });
    expect(first.ok).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    await Promise.all([
      common.follow!(["c".repeat(64)], { windowId: "w" }),
      common.unfollow!(["a".repeat(64)], { windowId: "w" }),
    ]);
    const contacts = config.eventStore.getReplaceable(kinds.Contacts, await config.signer.getPublicKey())!;
    expect(
      contacts.tags
        .filter((tag) => tag[0] === "p")
        .map((tag) => tag[1])
        .sort(),
    ).toEqual(["b".repeat(64), "c".repeat(64)]);
    expect(contacts.created_at).toBeGreaterThan(first.event!.created_at);
  });

  it("waits for a contacts event instead of returning an initial empty model", async () => {
    const { config } = setup();
    const common = createCommonOptions({ ...config, timeout: 100 });
    const result = common.follows!({ windowId: "w" });
    const contacts = finalizeEvent(
      {
        kind: kinds.Contacts,
        content: "",
        tags: [["p", "a".repeat(64)]],
        created_at: unixNow(),
      },
      new Uint8Array(32).fill(1),
    );
    setTimeout(() => config.eventStore.add(contacts), 5);
    expect(await result).toMatchObject({ ok: true, pubkeys: ["a".repeat(64)] });
  });

  it.each(["switch", "timeout"])("prevents late approval from publishing after %s", async (reason) => {
    const { config, publish } = setup();
    const account$ = new BehaviorSubject({ signer: config.signer, pubkey: await config.signer.getPublicKey() });
    let approve!: (approved: boolean) => void;
    let entered!: () => void;
    const prompting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const sign = vi.spyOn(config.signer, "signEvent");
    const common = createCommonOptions({
      ...config,
      account$,
      actionTimeout: 30,
      approve: () => {
        entered();
        return new Promise<boolean>((resolve) => {
          approve = resolve;
        });
      },
    });
    const result = common.follow!(["a".repeat(64)], { windowId: "w" });
    await prompting;
    if (reason === "switch") {
      const replacement = new PrivateKeySigner(new Uint8Array(32).fill(2));
      account$.next({ signer: replacement, pubkey: await replacement.getPublicKey() });
    }
    expect(await result).toMatchObject({ ok: false });
    approve(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(account$.observed).toBe(false);
  });

  it("releases a timed-out contacts queue and suppresses a late signer result", async () => {
    const { config, publish } = setup();
    let complete!: (event: Awaited<ReturnType<typeof config.signer.signEvent>>) => void;
    const signed = await config.signer.signEvent({
      kind: kinds.Contacts,
      tags: [],
      content: "",
      created_at: unixNow(),
    });
    vi.spyOn(config.signer, "signEvent").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const common = createCommonOptions({ ...config, actionTimeout: 50 });
    expect(await common.follow!(["a".repeat(64)], { windowId: "first" })).toMatchObject({ ok: false });
    expect(await common.follow!(["b".repeat(64)], { windowId: "second" })).toMatchObject({ ok: true });
    complete(signed);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("bounds unresolved public-key resolution", async () => {
    const { config } = setup();
    vi.spyOn(config.signer, "getPublicKey").mockImplementation(() => new Promise(() => {}));
    const common = createCommonOptions(config);
    expect(await common.follow!(["a".repeat(64)], { windowId: "w" })).toMatchObject({ ok: false });
  });

  it("keeps each concurrent request's approval window and result separate", async () => {
    const { config } = setup();
    const approve = vi.fn(async (_request: { windowId?: string }) => true);
    const common = createCommonOptions({ ...config, approve, actionTimeout: 2000 });
    const [first, second] = await Promise.all([
      common.report!({ type: "pubkey", pubkey: "a".repeat(64) }, "spam", "first", { windowId: "one" }),
      common.report!({ type: "pubkey", pubkey: "b".repeat(64) }, "spam", "second", { windowId: "two" }),
    ]);
    expect(first.event?.content).toBe("first");
    expect(second.event?.content).toBe("second");
    expect(approve.mock.calls.map(([request]) => request.windowId).sort()).toEqual(["one", "two"]);
  });

  it("loads reaction relay lists reactively and preserves custom emoji tags", async () => {
    const { config, publish } = setup();
    const author = new PrivateKeySigner(new Uint8Array(32).fill(2));
    const target = await author.signEvent({
      kind: kinds.ShortTextNote,
      tags: [],
      content: "hello",
      created_at: unixNow(),
    });
    config.eventStore.add(target);
    const common = createCommonOptions({ ...config, timeout: 100, actionTimeout: 1000 });
    const result = common.react!(target.id, ":wave:", "https://example.com/wave.png", { windowId: "w" });
    const inbox = await author.signEvent({
      kind: kinds.RelayList,
      tags: [["r", "wss://author.example.com/", "read"]],
      content: "",
      created_at: unixNow(),
    });
    const outbox = await config.signer.signEvent({
      kind: kinds.RelayList,
      tags: [["r", "wss://owner.example.com/", "write"]],
      content: "",
      created_at: unixNow(),
    });
    setTimeout(() => {
      config.eventStore.add(inbox);
      config.eventStore.add(outbox);
    }, 5);
    const reaction = await result;
    expect(reaction.ok).toBe(true);
    expect(reaction.event?.tags).toContainEqual(["emoji", "wave", "https://example.com/wave.png"]);
    expect(publish).toHaveBeenCalledWith(
      expect.arrayContaining(["wss://owner.example.com/", "wss://author.example.com/"]),
      reaction.event,
    );
  });

  it("returns a failure when approval is denied without signing or publishing", async () => {
    const { config, publish } = setup();
    const sign = vi.spyOn(config.signer, "signEvent");
    const common = createCommonOptions({ ...config, approve: () => false });
    expect(await common.follow!(["a".repeat(64)], { windowId: "w" })).toMatchObject({
      ok: false,
      error: "User denied",
    });
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("validates every contact before making a partial change", async () => {
    const { config, publish } = setup();
    const common = createCommonOptions(config);
    expect(await common.follow!(["a".repeat(64), "invalid"], { windowId: "w" })).toMatchObject({ ok: false });
    expect(publish).not.toHaveBeenCalled();
  });
});
