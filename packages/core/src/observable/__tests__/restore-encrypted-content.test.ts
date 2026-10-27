import { from, lastValueFrom, Subject, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { getEncryptedContent, setEncryptedContentCache } from "../../helpers/encrypted-content.js";
import { isEncryptedContentFromCache } from "../../helpers/encrypted-content-cache.js";
import { kinds } from "../../helpers/event.js";
import { restoreEncryptedContentFromCache } from "../restore-encrypted-content.js";

const user = new FakeUser();
const encryptedEvent = () => user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });

describe("restoreEncryptedContentFromCache", () => {
  it("restores hits and passes through misses and failures without dropping events", async () => {
    const events = Array.from({ length: 4 }, encryptedEvent);
    const storage = {
      getItem: vi
        .fn()
        .mockReturnValueOnce("")
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(() => {
          throw new Error("sync failure");
        })
        .mockRejectedValueOnce(new Error("async failure")),
      setItem: vi.fn(),
    };
    const restored = await lastValueFrom(from(events).pipe(restoreEncryptedContentFromCache(storage), toArray()));

    expect(new Set(restored)).toEqual(new Set(events));
    expect(getEncryptedContent(events[0])).toBe("");
    expect(isEncryptedContentFromCache(events[0])).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("skips unsupported and already unlocked events", async () => {
    const events = [user.note(), encryptedEvent()];
    setEncryptedContentCache(events[1], "plaintext");
    const storage = { getItem: vi.fn(), setItem: vi.fn() };

    expect(await lastValueFrom(from(events).pipe(restoreEncryptedContentFromCache(storage), toArray()))).toEqual(
      events,
    );
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("caps parallel reads and waits for them before completion", async () => {
    const events = Array.from({ length: 3 }, encryptedEvent);
    const pending: Array<(value: string | null) => void> = [];
    const storage = {
      getItem: vi.fn(() => new Promise<string | null>((resolve) => pending.push(resolve))),
      setItem: vi.fn(),
    };
    const emitted: typeof events = [];
    const complete = vi.fn();
    from(events)
      .pipe(restoreEncryptedContentFromCache(storage, 2))
      .subscribe({
        next: (event) => {
          expect(getEncryptedContent(event)).toBe("plaintext");
          emitted.push(event);
        },
        complete,
      });

    expect(storage.getItem).toHaveBeenCalledTimes(2);
    pending[1]("plaintext");
    await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalledTimes(3));
    expect(emitted).toEqual([events[1]]);
    expect(complete).not.toHaveBeenCalled();

    pending[0]("plaintext");
    pending[2]("plaintext");
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(emitted).toEqual([events[1], events[0], events[2]]);
  });

  it("is cold and starts no queued lookups after unsubscription", async () => {
    const events = Array.from({ length: 2 }, encryptedEvent);
    let finishRead!: (value: null) => void;
    const storage = {
      getItem: vi.fn(
        () =>
          new Promise<null>((resolve) => {
            finishRead = resolve;
          }),
      ),
      setItem: vi.fn(),
    };
    const stream = from(events).pipe(restoreEncryptedContentFromCache(storage, 1));
    const next = vi.fn();
    expect(storage.getItem).not.toHaveBeenCalled();
    const subscription = stream.subscribe(next);
    subscription.unsubscribe();
    finishRead(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves order with concurrency one and propagates source errors", async () => {
    const events = Array.from({ length: 2 }, encryptedEvent);
    const storage = { getItem: () => null, setItem: () => {} };
    expect(await lastValueFrom(from(events).pipe(restoreEncryptedContentFromCache(storage, 1), toArray()))).toEqual(
      events,
    );

    const source = new Subject<ReturnType<typeof encryptedEvent>>();
    const error = vi.fn();
    source.pipe(restoreEncryptedContentFromCache(storage)).subscribe({ error });
    const failure = new Error("source failure");
    source.error(failure);
    expect(error).toHaveBeenCalledWith(failure);
  });

  it.each([0, -1, 1.5, Infinity, NaN])("rejects invalid concurrency %s", (concurrency) => {
    expect(() => restoreEncryptedContentFromCache({ getItem: () => null, setItem: () => {} }, concurrency)).toThrow();
  });
});
