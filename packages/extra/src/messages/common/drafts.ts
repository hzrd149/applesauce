import { BehaviorSubject, defer, ReplaySubject, switchMap, takeUntil } from "rxjs";
import type { MessageDraft, MessageFileStorage, MessageStorage } from "./types.js";

/** The saved description of a draft file whose bytes live in the file storage */
interface SavedDraftFile {
  id: string;
  name: string;
  type: string;
  lastModified: number;
}

function parseDraft(value: unknown): Readonly<MessageDraft> {
  if (!value || typeof value !== "object") throw new Error("Invalid conversation draft");
  const draft = value as MessageDraft;
  if (
    typeof draft.content !== "string" ||
    (draft.replyTo !== undefined && typeof draft.replyTo !== "string") ||
    (draft.expiration !== undefined && (!Number.isSafeInteger(draft.expiration) || draft.expiration < 0)) ||
    (draft.files !== undefined && (!Array.isArray(draft.files) || !draft.files.every((file) => file instanceof File)))
  ) {
    throw new Error("Invalid conversation draft");
  }

  const files = draft.files?.length ? Object.freeze([...draft.files]) : undefined;
  return Object.freeze({ content: draft.content, replyTo: draft.replyTo, expiration: draft.expiration, files });
}

function parseSavedFiles(value: unknown): SavedDraftFile[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (file): file is SavedDraftFile =>
      typeof file?.id === "string" &&
      typeof file.name === "string" &&
      typeof file.type === "string" &&
      Number.isFinite(file.lastModified),
  );
}

/** Manages one conversation's editable draft and optional persistence */
export class ConversationDraftState {
  private readonly draft = new BehaviorSubject<Readonly<MessageDraft> | undefined>(undefined);
  private readonly destroyed = new ReplaySubject<void>(1);
  private operations: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private disposed = false;
  /** The files whose bytes are currently in the file storage for this draft */
  private savedFiles: SavedDraftFile[] = [];
  /** The saved IDs of staged files, so saving the same draft again skips rewriting them */
  private readonly fileIds = new WeakMap<File, string>();

  /** The current draft, restored on subscription without starting message loading */
  readonly draft$ = defer(() => this.load()).pipe(
    switchMap(() => this.draft.asObservable()),
    takeUntil(this.destroyed),
  );

  /** Creates draft state with an application-scoped conversation storage key */
  constructor(
    private readonly key: string,
    private readonly storage?: MessageStorage,
    private readonly fileStorage?: MessageFileStorage,
  ) {}

  /** Files are only persisted when there is also a saved draft record to reference them */
  private get persistsFiles(): boolean {
    return this.storage !== undefined && this.fileStorage !== undefined;
  }

  private fileKey(id: string): string {
    return `${this.key}:file:${id}`;
  }

  /** Writes staged files that are not already stored and returns their saved descriptions */
  private async saveFiles(files: readonly File[]): Promise<SavedDraftFile[]> {
    if (!this.fileStorage || !this.persistsFiles) return [];

    const saved: SavedDraftFile[] = [];
    for (const file of files) {
      let id = this.fileIds.get(file);
      const isStored = id !== undefined && this.savedFiles.some((existing) => existing.id === id);

      if (!id || !isStored) {
        id = crypto.randomUUID();
        await this.fileStorage.setItem(this.fileKey(id), file);
        this.fileIds.set(file, id);
      }

      saved.push({ id, name: file.name, type: file.type, lastModified: file.lastModified });
    }

    return saved;
  }

  /** Reads saved files back, skipping any whose bytes are missing */
  private async restoreFiles(savedFiles: SavedDraftFile[]): Promise<{ files: File[]; saved: SavedDraftFile[] }> {
    const files: File[] = [];
    const saved: SavedDraftFile[] = [];
    if (!this.fileStorage) return { files, saved };

    for (const savedFile of savedFiles) {
      const blob = await this.fileStorage.getItem(this.fileKey(savedFile.id));
      if (!blob) continue;

      const file = new File([blob], savedFile.name, { type: savedFile.type, lastModified: savedFile.lastModified });
      this.fileIds.set(file, savedFile.id);
      files.push(file);
      saved.push(savedFile);
    }

    return { files, saved };
  }

  /** Removes stored file bytes, ignoring failures since an orphaned file only wastes space */
  private async removeFiles(files: SavedDraftFile[]): Promise<void> {
    if (!this.fileStorage) return;

    for (const file of files) {
      try {
        await this.fileStorage.removeItem(this.fileKey(file.id));
      } catch {
        // The draft record no longer references this file.
      }
    }
  }

  /** Reads which files the saved record references when the draft was replaced before being loaded */
  private async readSavedFiles(): Promise<void> {
    if (this.loaded || !this.persistsFiles) return;

    try {
      const serialized = await this.storage?.getItem(this.key);
      if (serialized != null) this.savedFiles = parseSavedFiles(JSON.parse(serialized)?.files);
    } catch {
      // An unreadable record is replaced anyway; its files can only be left behind.
    }
  }

  /** Removes the saved draft record and all of its files */
  private async removeSaved(): Promise<void> {
    await this.readSavedFiles();
    await this.storage?.removeItem(this.key);

    const removedFiles = this.savedFiles;
    this.savedFiles = [];
    await this.removeFiles(removedFiles);
  }

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

          if (this.persistsFiles) {
            const { files, saved } = await this.restoreFiles(parseSavedFiles(record.files));
            this.savedFiles = saved;
            if (files.length > 0) draft = Object.freeze({ ...draft, files: Object.freeze(files) });
          }
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
      // Write new files before the record that references them, then drop files it no longer references.
      await this.readSavedFiles();
      const savedFiles = await this.saveFiles(snapshot.files ?? []);

      const { content, replyTo, expiration } = snapshot;
      const record = { version: 1, draft: { content, replyTo, expiration }, files: savedFiles };
      await this.storage?.setItem(this.key, JSON.stringify(record));
      this.assertActive();

      const savedIds = new Set(savedFiles.map((file) => file.id));
      const removedFiles = this.savedFiles.filter((file) => !savedIds.has(file.id));
      this.savedFiles = savedFiles;
      await this.removeFiles(removedFiles);

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
      await this.removeSaved();
      this.assertActive();
      this.loaded = true;
      this.draft.next(undefined);
    });
  }

  /**
   * Removes only the captured immutable draft revision while its operation is active
   * @throws if disposed, cancelled before removal starts, or storage fails
   */
  clearIfCurrent(snapshot: Readonly<MessageDraft>, signal: AbortSignal): Promise<void> {
    return this.enqueue(async () => {
      signal.throwIfAborted();
      // Each successful edit creates a new frozen object, even for identical content.
      if (this.draft.value !== snapshot) return;

      await this.removeSaved();
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
