import { Subject, type Observable } from "rxjs";
import type { RekeyCandidateDiagnostic } from "../helpers/keys.js";
import { isStrictlyLowerKey } from "../helpers/rekey.js";

export type RotationDiagnosticReason = RekeyCandidateDiagnostic["reason"] | "reconciliation-exhausted";

export interface RotationDiagnostic {
  scopeId: string;
  candidateId: string;
  status: "parked" | "rejected";
  reason: RotationDiagnosticReason;
  attempt?: number;
  cause?: unknown;
}

export type RotationOutcome<T> =
  | { kind: "adopt"; next: T; epoch: number; diagnostics?: RekeyCandidateDiagnostic[] }
  | { kind: "removed"; epoch: number; diagnostics?: RekeyCandidateDiagnostic[] }
  | { kind: "none"; diagnostics?: RekeyCandidateDiagnostic[] };

export interface RotationCoordinatorOptions<T> {
  scopeId: string;
  read: () => Promise<RotationOutcome<T>>;
  keyOf: (next: T) => Uint8Array;
  adopt: (next: T) => void | Promise<void>;
  remove: () => void | Promise<void>;
  fetch?: () => void | Promise<void>;
  onFatal: (cause: unknown) => void;
  diagnostics?: Subject<RotationDiagnostic>;
  maxAttempts?: number;
  lifetimeMs?: number;
  now?: () => number;
}

const RECONCILABLE = new Set<RekeyCandidateDiagnostic["reason"]>([
  "incomplete",
  "inconsistent",
  "continuity-gap",
  "citation-missing",
  "citation-mismatch",
  "decrypt-failed",
]);

/** Shared live/historical down-only convergence decision. */
export function shouldAdoptRotation(existing: Uint8Array | undefined, candidate: Uint8Array): boolean {
  return existing === undefined || isStrictlyLowerKey(existing, candidate);
}

/** Serializes rotation folds while keeping bounded candidate fetches independent. */
export class RotationCoordinator<T> {
  private serial = Promise.resolve();
  private readonly latches = new Map<number, Uint8Array>();
  private readonly fetches = new Map<string, { attempts: number; started: number; running: boolean }>();
  private readonly exhausted = new Set<string>();
  private disposed = false;
  readonly diagnostics$: Observable<RotationDiagnostic>;
  private readonly diagnostics: Subject<RotationDiagnostic>;

  constructor(private readonly opts: RotationCoordinatorOptions<T>) {
    this.diagnostics = opts.diagnostics ?? new Subject<RotationDiagnostic>();
    this.diagnostics$ = this.diagnostics.asObservable();
  }

  notify(): void {
    this.serial = this.serial.then(() => this.evaluate()).catch((cause) => this.opts.onFatal(cause));
  }

  /** Resolves after all evaluations currently queued on the serialized fold lane. */
  async idle(): Promise<void> {
    await this.serial;
  }

  latch(epoch: number, key: Uint8Array): void {
    this.latches.set(epoch, key);
  }

  dispose(): void {
    this.disposed = true;
    if (!this.opts.diagnostics) this.diagnostics.complete();
  }

  private async evaluate(): Promise<void> {
    if (this.disposed) return;
    const outcome = await this.opts.read();
    for (const diagnostic of outcome.diagnostics ?? []) {
      this.diagnostics.next({ scopeId: this.opts.scopeId, ...diagnostic });
      if (diagnostic.status === "parked" && RECONCILABLE.has(diagnostic.reason)) this.reconcile(diagnostic);
    }
    if (this.disposed || outcome.kind === "none") return;
    if (outcome.kind === "removed") return void (await this.opts.remove());
    const candidate = this.opts.keyOf(outcome.next);
    const latched = this.latches.get(outcome.epoch);
    if (!shouldAdoptRotation(latched, candidate)) return;
    this.latches.set(outcome.epoch, candidate);
    await this.opts.adopt(outcome.next);
  }

  private reconcile(diagnostic: RekeyCandidateDiagnostic): void {
    if (!this.opts.fetch) return;
    const pin = diagnostic.reason === "citation-missing" || diagnostic.reason === "citation-mismatch" ? diagnostic.reason : "set";
    const id = `${diagnostic.candidateId}:${pin}`;
    if (this.exhausted.has(id)) return;
    const now = (this.opts.now ?? Date.now)();
    const state = this.fetches.get(id) ?? { attempts: 0, started: now, running: false };
    if (state.running) return;
    const maxAttempts = this.opts.maxAttempts ?? 3;
    const lifetimeMs = this.opts.lifetimeMs ?? 8_000;
    if (state.attempts >= maxAttempts || now - state.started >= lifetimeMs) {
      this.diagnostics.next({
        scopeId: this.opts.scopeId,
        candidateId: diagnostic.candidateId,
        status: "rejected",
        reason: "reconciliation-exhausted",
        attempt: state.attempts,
      });
      this.fetches.delete(id);
      this.exhausted.add(id);
      return;
    }
    state.running = true;
    state.attempts++;
    this.fetches.set(id, state);
    void Promise.resolve(this.opts.fetch())
      .then(() => this.notify())
      .catch((cause) => {
        this.diagnostics.next({
          scopeId: this.opts.scopeId,
          candidateId: diagnostic.candidateId,
          status: "parked",
          reason: diagnostic.reason,
          attempt: state.attempts,
          cause,
        });
      })
      .finally(() => {
        state.running = false;
      });
  }
}
