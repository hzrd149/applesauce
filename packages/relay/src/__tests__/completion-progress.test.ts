import { Subject, filter, take } from "rxjs";
import { TestScheduler } from "rxjs/testing";
import { describe, expect, it } from "vitest";
import { RelayGroup } from "../group.js";
import type { GroupReqMessage } from "../types.js";

function completion(entries: [number, string | null][], operator = RelayGroup.completeAfterIdle()) {
  const scheduler = new TestScheduler(() => {});
  let completed: number | undefined;
  scheduler.run(() => {
    const messages = new Subject<GroupReqMessage>();
    const subscription = messages
      .pipe(operator, filter(Boolean), take(1))
      .subscribe(() => (completed = scheduler.now()));
    for (const [time, id] of entries) {
      scheduler.schedule(
        () =>
          messages.next(
            id === null
              ? { type: "EOSE", from: "fast" }
              : ({ type: "EVENT", from: "slow", event: { id } } as GroupReqMessage),
          ),
        time,
      );
    }
    scheduler.schedule(() => subscription.unsubscribe(), 30_000);
  });
  return completed;
}

describe("idle completion progress", () => {
  it("ignores a slow replay of ids received before the first EOSE", () => {
    expect(
      completion([
        [0, "a"],
        [100, null],
        [1000, "a"],
        [2000, "a"],
        [3000, "a"],
        [4000, "a"],
        [5000, "a"],
        [6000, "a"],
      ]),
    ).toBe(5100);
  });

  it("keeps waiting while slow relays contribute new ids", () => {
    expect(
      completion([
        [100, null],
        [1000, "a"],
        [2000, "b"],
        [3000, "c"],
        [4000, "d"],
      ]),
    ).toBe(5500);
  });

  it("does not extend the idle window for duplicates of late new ids", () => {
    expect(
      completion([
        [100, null],
        [2900, "new"],
        [4000, "new"],
        [5000, "new"],
        [6000, "new"],
        [7000, "new"],
        [8000, "new"],
      ]),
    ).toBe(7900);
  });

  it("bounds continuous unique progress at the cap", () => {
    const entries: [number, string | null][] = [[100, null]];
    for (let i = 1; i < 25; i++) entries.push([i * 1000, String(i)]);
    expect(completion(entries)).toBe(15100);
  });

  it("creates independent progress tracking for every subscription", () => {
    const operator = RelayGroup.completeAfterIdle();
    const entries: [number, string | null][] = [
      [100, null],
      [2900, "new"],
    ];
    expect(completion(entries, operator)).toBe(4400);
    expect(completion(entries, operator)).toBe(4400);
  });

  it("allows useful events separated by duplicate traffic", () => {
    expect(
      completion([
        [100, null],
        [1000, "a"],
        [2000, "a"],
        [3000, "a"],
        [4000, "a"],
        [5000, "b"],
      ]),
    ).toBe(6500);
  });

  it("does not let progress timeout shorten a custom idle window", () => {
    expect(
      completion(
        [
          [100, null],
          [1000, "a"],
          [2000, "a"],
        ],
        RelayGroup.completeAfterIdle({ idle: 8000 }),
      ),
    ).toBe(9000);
  });

  it("leaves no-EOSE completion to the request timeout", () => {
    expect(
      completion([
        [0, "a"],
        [10000, "b"],
      ]),
    ).toBeUndefined();
  });
});
