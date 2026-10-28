import { BehaviorSubject, defer, ReplaySubject, switchMap, takeUntil } from "rxjs";
import type { MessageDraft, MessageStorage } from "./types.js";

function parseDraft(value: unknown): Readonly<MessageDraft> {
  if (!value || typeof value !== "object") throw new Error("Invalid conversation draft");
  const draft = value as MessageDraft;
  if (
    typeof draft.content !== "string" ||
    (draft.replyTo !== undefined && typeof draft.replyTo !== "string") ||
    (draft.expiration !== undefined && (!Number.isSafeInteger(draft.expiration) || draft.expiration < 0))
  ) {
    throw new Error("Invalid conversation draft");
  }

  return Object.freeze({ content: draft.content, replyTo: draft.replyTo, expiration: draft.expiration });
}

/** Manages one conversation's editable draft and optional persistence */
export class ConversationDraftState {
  private readonly draft = new BehaviorSubject<Readonly<MessageDraft> | undefined>(undefined);
  private readonly destroyed = new ReplaySubject<void>(1);
  private operations: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private disposed = false;

  /** The current draft, restored on subscription without starting message loading */
  readonly draft$ = defer(() => this.load()).pipe(
    switchMap(() => this.draft.asObservable()),
    takeUntil(this.destroyed),
  );

  /** Creates draft state with an application-scoped conversation storage key */
  constructor(
    private readonly key: string,
    private readonly storage?: MessageStorage,
  ) {}

  private assertActive(): void {
    if (this.disposed) throw new Error("Conversation disposed");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(async () => {
      this.assertActive();
      return operation();
    });
    // A failed operation must not prevent later edits or a storage retry.
    this.operations = result.catch(() => undefined);
    return result;
  }

  /**
   * Restores the saved draft once and returns the current value
   * @throws if disposed, reading fails, or the stored draft is invalid
   */
  load(): Promise<Readonly<MessageDraft> | undefined> {
    return this.enqueue(async () => {
      if (!this.loaded) {
        const serialized = await this.storage?.getItem(this.key);
        this.assertActive();
        let draft: Readonly<MessageDraft> | undefined;
        if (serialized != null) {
          const record = JSON.parse(serialized);
          if (record?.version !== 1) throw new Error("Unsupported conversation draft version");
          draft = parseDraft(record.draft);
        }
        this.loaded = true;
        this.draft.next(draft);
      }
      return this.draft.value;
    });
  }

  /**
   * Saves a draft before notifying subscribers
   * @throws if disposed, the draft is invalid, or writing fails
   */
  async set(draft: MessageDraft): Promise<void> {
    const snapshot = parseDraft(draft);
    return this.enqueue(async () => {
      await this.storage?.setItem(this.key, JSON.stringify({ version: 1, draft: snapshot }));
      this.assertActive();
      this.loaded = true;
      this.draft.next(snapshot);
    });
  }

  /**
   * Removes the saved draft before notifying subscribers
   * @throws if disposed or removing the draft fails
   */
  clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.storage?.removeItem(this.key);
      this.assertActive();
      this.loaded = true;
      this.draft.next(undefined);
    });
  }

  /** Releases local draft state while preserving the saved draft */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroyed.next();
    this.destroyed.complete();
    this.draft.next(undefined);
    this.draft.complete();
  }
}
