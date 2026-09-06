import { describe, expect, it, vi } from "vitest";
import { firstValueFrom, take, toArray } from "rxjs";
import { RotationCoordinator, type RotationDiagnostic, type RotationOutcome } from "../rotation.js";

type Next = { key: Uint8Array };

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function harness(outcomes: RotationOutcome<Next>[]) {
  const adopted: Next[] = [];
  const fatal: unknown[] = [];
  const fetch = vi.fn(async () => undefined);
  const coordinator = new RotationCoordinator<Next>({
    scopeId: "root",
    read: vi.fn(async () => outcomes.shift() ?? { kind: "none" }),
    keyOf: (next) => next.key,
    adopt: (next) => void adopted.push(next),
    remove: vi.fn(),
    fetch,
    onFatal: (cause) => void fatal.push(cause),
  });
  return { coordinator, adopted, fatal, fetch };
}

describe("RotationCoordinator", () => {
  it("adopts a lower live sibling but never moves the latch equal or upward", async () => {
    const high = { key: Uint8Array.of(9) };
    const low = { key: Uint8Array.of(1) };
    const h = harness([
      { kind: "adopt", epoch: 1, next: high },
      { kind: "adopt", epoch: 1, next: low },
      { kind: "adopt", epoch: 1, next: high },
      { kind: "adopt", epoch: 1, next: low },
    ]);
    for (let i = 0; i < 4; i++) {
      h.coordinator.notify();
      await h.coordinator.idle();
    }
    expect(h.adopted).toEqual([high, low]);
  });

  it.each(["incomplete", "inconsistent", "continuity-gap", "citation-missing"] as const)(
    "fetches and reevaluates a parked %s candidate",
    async (reason) => {
      const h = harness([
        { kind: "none", diagnostics: [{ candidateId: "candidate", status: "parked", reason }] },
        { kind: "adopt", epoch: 1, next: { key: Uint8Array.of(1) } },
      ]);
      h.coordinator.notify();
      await flush();
      await flush();
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(h.adopted).toHaveLength(1);
    },
  );

  it("deduplicates a candidate fetch while it is in flight", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi.fn(() => pending);
    const diagnostic = { candidateId: "candidate", status: "parked" as const, reason: "incomplete" as const };
    const coordinator = new RotationCoordinator<Next>({
      scopeId: "channel-id",
      read: vi.fn(async () => ({ kind: "none", diagnostics: [diagnostic] })),
      keyOf: (next) => next.key,
      adopt: vi.fn(),
      remove: vi.fn(),
      fetch,
      onFatal: vi.fn(),
    });
    coordinator.notify();
    coordinator.notify();
    await coordinator.idle();
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
  });

  it("exhausts one mismatched citation after three bounded attempts", async () => {
    const diagnostic = { candidateId: "candidate", status: "parked" as const, reason: "citation-mismatch" as const };
    const read = vi.fn(async () => ({ kind: "none" as const, diagnostics: [diagnostic] }));
    const fetch = vi.fn(async () => undefined);
    const coordinator = new RotationCoordinator<Next>({
      scopeId: "root",
      read,
      keyOf: (next) => next.key,
      adopt: vi.fn(),
      remove: vi.fn(),
      fetch,
      onFatal: vi.fn(),
    });
    const exhausted = firstValueFrom(
      coordinator.diagnostics$.pipe(
        take(5),
        toArray(),
      ),
    );
    coordinator.notify();
    for (let i = 0; i < 8; i++) {
      await flush();
      await coordinator.idle();
    }
    const seen = await exhausted;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(seen.at(-1)).toMatchObject({
      scopeId: "root",
      candidateId: "candidate",
      reason: "reconciliation-exhausted",
      attempt: 3,
    });
  });

  it("reports remote defects without failing the coordinator", async () => {
    const diagnostics = [
      { candidateId: "bad", status: "rejected" as const, reason: "malformed" as const },
    ];
    const h = harness([{ kind: "none", diagnostics }]);
    const seen = firstValueFrom(h.coordinator.diagnostics$.pipe(take(1), toArray()));
    h.coordinator.notify();
    expect(await seen).toEqual<RotationDiagnostic[]>([{ scopeId: "root", ...diagnostics[0] }]);
    expect(h.fatal).toEqual([]);
  });

  it("preserves the original local transition failure as fatal", async () => {
    const cause = new Error("persistence failed");
    const h = harness([{ kind: "adopt", epoch: 1, next: { key: Uint8Array.of(1) } }]);
    h.coordinator.dispose();
    const coordinator = new RotationCoordinator<Next>({
      scopeId: "root",
      read: async () => ({ kind: "adopt", epoch: 1, next: { key: Uint8Array.of(1) } }),
      keyOf: (next) => next.key,
      adopt: async () => Promise.reject(cause),
      remove: vi.fn(),
      onFatal: (error) => h.fatal.push(error),
    });
    coordinator.notify();
    await coordinator.idle();
    expect(h.fatal).toEqual([cause]);
  });
});
