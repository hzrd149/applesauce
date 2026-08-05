import { describe, expect, it } from "vitest";
import { setCachedValue } from "../cache.js";
import { pipeFromAsyncArray } from "../pipeline.js";

/**
 * Plan 05.1-13: the delete-loop half of pipeFromAsyncArray's symbol handling
 * (Reflect.ownKeys(result) filtered to symbols, then Reflect.deleteProperty
 * for anything not in `preserve`) has been removed — it scrubbed enumerable
 * symbol writes that rode a spread, but every symbol write in this codebase
 * is now non-enumerable via setCachedValue (Plans 07-12), so nothing
 * enumerable is ever left for the delete loop to strip.
 *
 * The carry-forward half (restoring a `preserve`-listed symbol the previous
 * value had and the result dropped via its own spread) is the permanent
 * mechanism and is exercised directly here, without routing through
 * eventPipe/sign — cache.test.ts already covers that fuller path.
 */
describe("pipeFromAsyncArray carry-forward (delete-loop removed, Plan 05.1-13)", () => {
  const kept = Symbol("preserved-memo");
  const dropped = Symbol("non-preserved-memo");

  it("carries forward a preserved symbol dropped by a same-kind step's own spread", async () => {
    const preserve = new Set([kept]);

    const input: Record<string, unknown> = { kind: 1, tags: [] };
    setCachedValue(input, kept, "kept-value");

    // Mirrors a real operation like modifyPublicTags: `{ ...draft, tags }` copies only
    // enumerable own properties, so the non-enumerable memo does not survive naturally.
    const spreadStep = (value: any) => ({ ...value, tags: [...value.tags, "x"] });

    const piped = pipeFromAsyncArray([spreadStep], preserve);
    const result = await piped(input);

    expect(Reflect.has(result, kept)).toBe(true);
    expect(Reflect.get(result, kept)).toBe("kept-value");
  });

  it("does not carry forward a symbol that is not in the preserve set", async () => {
    const preserve = new Set([kept]);

    const input: Record<string, unknown> = { kind: 1, tags: [] };
    setCachedValue(input, dropped, "will-not-survive");

    const spreadStep = (value: any) => ({ ...value, tags: [...value.tags, "x"] });

    const piped = pipeFromAsyncArray([spreadStep], preserve);
    const result = await piped(input);

    // Dropped because the spread never copies a non-enumerable write in the first place —
    // not because a delete loop scrubbed it (that half no longer exists).
    expect(Reflect.has(result, dropped)).toBe(false);
  });

  it("does not carry forward a preserved symbol across a kind-changing (different-event) step", async () => {
    const preserve = new Set([kept]);

    const input: Record<string, unknown> = { kind: 1, tags: [] };
    setCachedValue(input, kept, "kept-value");

    // A transform step that produces a different-kind result (e.g. gift-wrap's
    // rumor -> seal -> wrap): the sameEvent guard must block carry-forward here.
    const kindChangingStep = (value: any) => ({ kind: 2, tags: [] });

    const piped = pipeFromAsyncArray([kindChangingStep], preserve);
    const result = await piped(input);

    expect((result as any).kind).toBe(2);
    expect(Reflect.has(result, kept)).toBe(false);
  });

  it("with no preserve set, symbols are simply left alone (no delete loop runs)", async () => {
    const input: Record<string, unknown> = { kind: 1, tags: [] };
    setCachedValue(input, dropped, "value");

    const identityStep = (value: any) => value;

    const piped = pipeFromAsyncArray([identityStep]);
    const result = await piped(input);

    expect(Reflect.get(result, dropped)).toBe("value");
  });
});
