import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers/event";
import { bufferTime, EMPTY, Subject } from "rxjs";
import { describe, expect, it, Mock, vi } from "vitest";

import { batchLoader } from "../../helpers/loaders.js";
import { AddressPointersLoader } from "../address-loader.js";
import { FakeUser } from "../../__tests__/fake-user.js";

const user = new FakeUser();

describe("batchLoader", () => {
  it("should batch requests", async () => {
    vi.useFakeTimers();
    const upstream: Mock<AddressPointersLoader> = vi.fn().mockReturnValue(EMPTY);
    const loader = batchLoader(bufferTime(100), upstream, () => true);

    const request1 = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));
    const request2 = subscribeSpyTo(loader({ kind: 3, pubkey: user.pubkey }));

    // skip 5s to let loader batch requests
    vi.advanceTimersByTime(2000);

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream).toBeCalledWith([
      { kind: 0, pubkey: user.pubkey },
      { kind: 3, pubkey: user.pubkey },
    ]);
    expect(request1.receivedComplete()).toBe(true);
    expect(request2.receivedComplete()).toBe(true);
  });

  it("should complete batches when upstream completes", () => {
    vi.useFakeTimers();
    const upstream = vi.fn();
    const loader = batchLoader(bufferTime(100), upstream, () => true);

    const first = new Subject<NostrEvent>();
    upstream.mockReturnValueOnce(first);

    const request1 = subscribeSpyTo(loader({ kind: 0, pubkey: user.pubkey }));

    // Should start batch
    vi.advanceTimersByTime(150);
    expect(upstream).toHaveBeenCalledTimes(1);

    const second = new Subject<NostrEvent>();
    upstream.mockReturnValueOnce(second);

    const request2 = subscribeSpyTo(loader({ kind: 3, pubkey: user.pubkey }));

    // Should start batch
    vi.advanceTimersByTime(150);
    expect(upstream).toHaveBeenCalledTimes(2);

    // Complete first batch
    first.complete();
    expect(request1.receivedComplete()).toBe(true);

    // Complete second request
    second.complete();
    expect(request2.receivedComplete()).toBe(true);
  });
});
