import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { isFromCache } from "applesauce-core/helpers/event";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { CacheRelease } from "../../types.js";
import { makeCacheRequest, streamCacheRequest, unwrapCacheRequest } from "../cache.js";

describe("cache request normalization", () => {
  it.each(["event", "array", "promise", "observable"])("preserves %s cache results", async (format) => {
    const event = new FakeUser().note(format);
    const request = () => {
      if (format === "array") return [event];
      if (format === "promise") return Promise.resolve([event]);
      if (format === "observable") return of(event);
      return event;
    };
    const spy = subscribeSpyTo(makeCacheRequest(request, []));
    await spy.onComplete();
    expect(spy.getValues()).toEqual([event]);
    expect(isFromCache(event)).toBe(true);
  });

  it("preserves control messages without marking them as events", () => {
    const release: CacheRelease = Object.freeze({ type: "release" });
    const event = new FakeUser().note("stream");
    const request = vi.fn(() => of(release, event));
    const result = streamCacheRequest(request, []);
    expect(request).not.toHaveBeenCalled();

    expect(subscribeSpyTo(result).getValues()).toEqual([release, event]);
    expect(isFromCache(event)).toBe(true);
    expect(Reflect.ownKeys(release)).toEqual(["type"]);
  });

  it.each([makeCacheRequest, unwrapCacheRequest])("keeps event-only helpers free of release messages", (helper) => {
    const event = new FakeUser().note("event-only");
    const spy = subscribeSpyTo(helper(() => of({ type: "release" } as const, event), []));
    expect(spy.getValues()).toEqual([event]);
    expect(spy.receivedComplete()).toBe(true);
  });
});
