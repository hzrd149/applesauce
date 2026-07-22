import { BehaviorSubject, Subject, throwError } from "rxjs";
import { describe, expect, it, onTestFinished } from "vitest";

import { ExtraRelays, sameRelaySet, toRelaysObservable } from "../relays.js";

// Bare-host wss:// URLs normalize with an explicit trailing slash (URL's own
// pathname default), so these constants use the already-normalized form for
// use in emission/current assertions, and RELAY_B_NO_SLASH below is the
// trailing-slash-omitted variant used to prove merge()'s normalization.
const RELAY_A = "wss://a.example.com/";
const RELAY_B = "wss://b.example.com/";
const RELAY_B_NO_SLASH = "wss://b.example.com";

describe("sameRelaySet", () => {
  it("is true for identical members in a different order", () => {
    expect(sameRelaySet([RELAY_A, RELAY_B], [RELAY_B, RELAY_A])).toBe(true);
  });

  it("is false when lengths differ", () => {
    expect(sameRelaySet([RELAY_A], [RELAY_A, RELAY_B])).toBe(false);
  });

  it("is false when members differ", () => {
    expect(sameRelaySet([RELAY_A], [RELAY_B])).toBe(false);
  });

  it("is false when a duplicated member masks a genuine membership difference (multiset, a-side)", () => {
    expect(sameRelaySet(["x", "y"], ["x", "x"])).toBe(false);
  });

  it("is false when a duplicated member masks a genuine membership difference (multiset, b-side, symmetric)", () => {
    expect(sameRelaySet(["x", "x"], ["x", "y"])).toBe(false);
  });

  it("is true for the same deduplicated membership even when one side repeats a member", () => {
    expect(sameRelaySet(["x", "x"], ["x"])).toBe(true);
  });
});

describe("toRelaysObservable", () => {
  it("resolves a static array to [] then the array's members", () => {
    const emissions: string[][] = [];
    toRelaysObservable([RELAY_A]).subscribe((v) => emissions.push(v));

    expect(emissions).toEqual([[], [RELAY_A]]);
  });

  it("resolves undefined to exactly []", () => {
    const emissions: string[][] = [];
    toRelaysObservable(undefined).subscribe((v) => emissions.push(v));

    expect(emissions).toEqual([[]]);
  });

  it("resolves a BehaviorSubject seeded with a set to [] then that set, and reacts to a later emission (no take(1))", () => {
    const source = new BehaviorSubject<string[]>([RELAY_A]);
    const emissions: string[][] = [];
    toRelaysObservable(source).subscribe((v) => emissions.push(v));

    expect(emissions).toEqual([[], [RELAY_A]]);

    // A second, distinct emission must be visible to the resolved stream -
    // proves the resolver is continuous and never freezes at the first value.
    source.next([RELAY_B]);

    expect(emissions).toEqual([[], [RELAY_A], [RELAY_B]]);
  });

  it("produces no further emission when the same members are re-pushed in a new array instance", () => {
    const source = new BehaviorSubject<string[]>([RELAY_A, RELAY_B]);
    const emissions: string[][] = [];
    toRelaysObservable(source).subscribe((v) => emissions.push(v));

    expect(emissions.length).toBe(2); // [] then [RELAY_A, RELAY_B]

    // Same members, different array instance and order.
    source.next([RELAY_B, RELAY_A]);

    expect(emissions.length).toBe(2);
  });

  it("produces a distinct emission when a re-push genuinely differs in membership, even though the previous emission had a duplicate (D-09)", () => {
    const source = new BehaviorSubject<string[]>([RELAY_A, RELAY_B]);
    const emissions: string[][] = [];
    toRelaysObservable(source).subscribe((v) => emissions.push(v));

    expect(emissions.length).toBe(2); // [] then [RELAY_A, RELAY_B]

    // Genuinely different membership (RELAY_A repeated instead of RELAY_B) must
    // not be suppressed just because the previous emission also had 2 entries.
    source.next([RELAY_A, RELAY_A]);

    expect(emissions.length).toBe(3);
    expect(emissions.at(-1)).toEqual([RELAY_A, RELAY_A]);
  });

  it("emits [] and completes without erroring its subscriber when the source errors", async () => {
    const emissions: string[][] = [];
    let errored = false;
    let completed = false;

    toRelaysObservable(throwError(() => new Error("boom"))).subscribe({
      next: (v) => emissions.push(v),
      error: () => (errored = true),
      complete: () => (completed = true),
    });

    // Flush the macrotask queue - RxJS's unhandled-error reporter rethrows on a macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errored).toBe(false);
    expect(completed).toBe(true);
    expect(emissions).toEqual([[]]);
  });
});

describe("ExtraRelays", () => {
  it("resolves a static array synchronously with no await", () => {
    const holder = new ExtraRelays([RELAY_A]);
    expect(holder.current).toEqual([RELAY_A]);
  });

  it("reflects the latest pushed value of a BehaviorSubject synchronously after each push", () => {
    const source = new BehaviorSubject<string[]>([RELAY_A]);
    const holder = new ExtraRelays(source);

    expect(holder.current).toEqual([RELAY_A]);

    source.next([RELAY_B]);
    expect(holder.current).toEqual([RELAY_B]);
  });

  it("resolves undefined to [] and merge(base) is then an identity over base (D-14)", () => {
    const holder = new ExtraRelays(undefined);
    expect(holder.current).toEqual([]);
    expect(holder.merge([RELAY_B])).toEqual([RELAY_B]);
  });

  it("merge returns the normalized de-duplicated union of base and extras", () => {
    const holder = new ExtraRelays([RELAY_B_NO_SLASH]);
    // RELAY_B and RELAY_B_NO_SLASH normalize to the same entry, so the union
    // collapses to exactly two entries instead of three.
    expect(holder.merge([RELAY_A, RELAY_B])).toEqual([RELAY_A, RELAY_B]);
  });

  it("returns the exact same base array reference when built from undefined (D-14 identity fast path)", () => {
    const holder = new ExtraRelays(undefined);
    const base = [RELAY_B_NO_SLASH];
    // toBe, not toEqual: proves no normalization ran at all, not mere
    // structural equality - the bare-host URL keeps its un-normalized form.
    expect(holder.merge(base)).toBe(base);
    expect(holder.merge(base)).toEqual([RELAY_B_NO_SLASH]);
  });

  it("returns the base array verbatim (duplicates and an unparseable entry intact) when built from []", () => {
    const holder = new ExtraRelays([]);
    const base = ["wss://a.example.com", "wss://a.example.com", "not a url"];
    expect(holder.merge(base)).toBe(base);
  });

  it("reverts to the base-verbatim identity fast path once a non-empty extras snapshot goes back to empty", () => {
    const source = new BehaviorSubject<string[]>([]);
    const holder = new ExtraRelays(source);
    const base = [RELAY_B_NO_SLASH];

    expect(holder.merge(base)).toBe(base);

    source.next([RELAY_A]);
    const mergedWhileNonEmpty = holder.merge(base);
    expect(mergedWhileNonEmpty).not.toBe(base);
    expect(mergedWhileNonEmpty).toEqual([RELAY_B, RELAY_A]); // normalized union

    source.next([]);
    expect(holder.merge(base)).toBe(base);
  });

  it("does not throw and degrades to [] when the source errors after construction", async () => {
    const source = new Subject<string[]>();
    let uncaught: unknown;
    const onUncaught = (err: unknown) => (uncaught = err);
    process.on("uncaughtException", onUncaught);
    onTestFinished(() => process.off("uncaughtException", onUncaught));

    const holder = new ExtraRelays(source);
    source.next([RELAY_A]);
    expect(holder.current).toEqual([RELAY_A]);

    expect(() => source.error(new Error("boom"))).not.toThrow();

    // Flush the macrotask queue - RxJS's unhandled-error reporter rethrows on a macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(uncaught).toBeUndefined();
    expect(holder.current).toEqual([]);
  });

  it("keeps relays$ subscribable and emitting after the source has errored", async () => {
    const source = new Subject<string[]>();
    const holder = new ExtraRelays(source);
    source.next([RELAY_A]);
    source.error(new Error("boom"));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const emissions: string[][] = [];
    holder.relays$.subscribe((v) => emissions.push(v));
    expect(emissions).toEqual([[]]);

    // The subject itself must still be live (not errored/completed) - a fresh
    // subscriber attached after the error must still receive future values.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalSubject = (holder as any).subject as Subject<string[]>;
    internalSubject.next([RELAY_B]);
    expect(emissions).toEqual([[], [RELAY_B]]);
  });

  it("dispose() unsubscribes so a later push no longer changes current", () => {
    const source = new Subject<string[]>();
    const holder = new ExtraRelays(source);

    source.next([RELAY_A]);
    expect(holder.current).toEqual([RELAY_A]);

    holder.dispose();
    source.next([RELAY_B]);

    expect(holder.current).toEqual([RELAY_A]);
  });
});
