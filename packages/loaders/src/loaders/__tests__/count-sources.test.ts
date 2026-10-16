import { EMPTY, NEVER, of } from "rxjs";
import { TestScheduler } from "rxjs/testing";
import { describe, expect, it, vi } from "vitest";
import { fallbackCountSource, nip85CountSource, routingCountSource } from "../count-sources/index.js";
import type { CountContext, CountQuery, CountSource } from "../count-sources/types.js";

const query: CountQuery = {
  target: { id: "a".repeat(64), kind: 1, created_at: 0 },
  metric: { id: "test", unit: "events", assertionTag: "reaction_cnt" },
};

function context(clock: TestScheduler): CountContext {
  return { clock, deadline: 100, attemptTimeout: 80, transport: { run: (_, work) => work() } };
}

function source(id: string, count: CountSource["count"]): CountSource {
  return { id, policy: () => of(id), count };
}

for (const [name, group] of [
  ["fallback", fallbackCountSource],
  ["routing", (sources: CountSource[]) => routingCountSource("fallback", sources)],
] as const) {
  describe(name, () => {
    it("bounds later candidates by the remaining deadline", () => {
      const clock = new TestScheduler(() => {});
      const starts: number[] = [];
      let completed: number | undefined;
      const sources = ["a", "b"].map((id) =>
        source(id, () => {
          starts.push(clock.now());
          return NEVER;
        }),
      );
      group(sources)
        .count(query, context(clock))
        .subscribe({ complete: () => (completed = clock.now()) });
      clock.flush();
      expect(starts).toEqual([0, 80]);
      expect(completed).toBe(100);
    });

    it("advances after synchronous source failures and accepts zero", () => {
      const clock = new TestScheduler(() => {});
      const failure = new Error("source failed");
      const onFailure = vi.fn();
      const result = { metric: query.metric.id, value: 0, origin: { adapter: "b", relay: "wss://b.test/" } };
      const values: unknown[] = [];
      group([
        source("a", () => {
          throw failure;
        }),
        source("b", () => of(result)),
      ])
        .count(query, { ...context(clock), onFailure })
        .subscribe((value) => values.push(value));
      expect(onFailure).toHaveBeenCalledWith(failure);
      expect(values).toEqual([result]);
    });

    it("times out candidates that emit invalid data without completing", () => {
      const clock = new TestScheduler(() => {});
      clock.run(({ cold }) => {
        const invalid = { metric: query.metric.id, value: -1, origin: { adapter: "a", relay: "wss://a.test/" } };
        let completed: number | undefined;
        group([source("a", () => cold("a", { a: invalid })), source("b", () => EMPTY)])
          .count(query, context(clock))
          .subscribe({ complete: () => (completed = clock.now()) });
        clock.flush();
        expect(completed).toBe(80);
      });
    });
  });
}

it("defers assertion provider lookup until subscription and reports lookup errors through the stream", () => {
  const clock = new TestScheduler(() => {});
  const failure = new Error("providers unavailable");
  const providers = vi.fn(() => {
    throw failure;
  });
  const adapter = nip85CountSource({ request: () => EMPTY, providers });
  const result = adapter.count(query, context(clock));
  expect(providers).not.toHaveBeenCalled();
  const error = vi.fn();
  result.subscribe({ error });
  expect(error).toHaveBeenCalledWith(failure);
});
