import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { EMPTY, of, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { cacheLoadingSequence } from "../cache-sequence.js";
import { CacheEmission } from "../../types.js";
import { NostrEvent } from "applesauce-core/helpers/event";
import { FakeUser } from "../../__tests__/fake-user.js";

describe("cacheLoadingSequence", () => {
  it("defers requests and resets resolution state for repeated subscriptions", () => {
    const supplemental = new Subject<CacheEmission>();
    const user = new FakeUser();
    const a = user.note("a");
    const b = user.note("b");
    const primary = vi.fn(() => EMPTY);
    const cache = vi.fn(() => supplemental);
    const load = cacheLoadingSequence<NostrEvent>(cache, primary, (input, output) => input.id === output.id);
    const result = load([a, b]);
    expect(primary).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();

    const first = subscribeSpyTo(result);
    supplemental.next({ type: "release" });
    supplemental.next(a);
    first.unsubscribe();
    expect(supplemental.observed).toBe(false);

    const second = subscribeSpyTo(result);
    supplemental.next({ type: "release" });
    supplemental.next(b);
    expect(second.receivedComplete()).toBe(false);
    supplemental.next(a);
    expect(second.getValues()).toEqual([b, a]);
    expect(second.receivedComplete()).toBe(true);
    expect(supplemental.observed).toBe(false);
  });

  it("delivers the final synchronous supplemental result before completion", () => {
    const user = new FakeUser();
    const a = user.note("a");
    const b = user.note("b");
    const load = cacheLoadingSequence<NostrEvent>(
      () => of({ type: "release" } as const, b),
      () => of(a),
      (input, output) => input.id === output.id,
    );
    const spy = subscribeSpyTo(load([a, b]));

    expect(spy.getValues()).toEqual([a, b]);
    expect(spy.receivedComplete()).toBe(true);
  });
});
