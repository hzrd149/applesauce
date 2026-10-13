import type { IAsyncEventStore, IEventStore } from "applesauce-core";
import { isEvent, type NostrEvent } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { useMemo, useRef, type ChangeEvent } from "react";
import {
  EMPTY,
  Subject,
  catchError,
  concatMap,
  defer,
  endWith,
  exhaustMap,
  finalize,
  from,
  map,
  of,
  startWith,
  tap,
} from "rxjs";

interface ImportEventsButtonProps {
  eventStore: IEventStore | IAsyncEventStore;
  onImportComplete?: (stats: ImportStats) => void;
  className?: string;
  disabled?: boolean;
}
interface ImportStats {
  total: number;
  added: number;
  failed: number;
}
interface ImportProgress extends ImportStats {
  isImporting: boolean;
  currentFile?: string;
  cancelled?: boolean;
  error?: string;
}

export default function ImportEventsButton({
  eventStore,
  onImportComplete,
  className = "",
  disabled = false,
}: ImportEventsButtonProps) {
  const files$ = useMemo(() => new Subject<File>(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const onCompleteRef = useRef(onImportComplete);
  onCompleteRef.current = onImportComplete;
  const empty: ImportProgress = { total: 0, added: 0, failed: 0, isImporting: false };
  const progress: ImportProgress =
    use$(
      () =>
        files$.pipe(
          exhaustMap((file) =>
            defer(() => {
              cancelRef.current = false;
              let stats: ImportStats = { total: 0, added: 0, failed: 0 };
              return defer(() => file.text()).pipe(
                concatMap((text) => {
                  const array = text.trim().startsWith("[");
                  const records: unknown[] = array ? JSON.parse(text) : text.split("\n").filter((line) => line.trim());
                  const events: NostrEvent[] = [];
                  stats = { total: records.length, added: 0, failed: 0 };
                  for (const record of records) {
                    try {
                      const event: unknown = array ? record : JSON.parse(record as string);
                      if (isEvent(event)) events.push(event);
                      else stats.failed++;
                    } catch {
                      stats.failed++;
                    }
                  }
                  const batches = Array.from({ length: Math.ceil(events.length / 100) }, (_, index) =>
                    events.slice(index * 100, (index + 1) * 100),
                  );
                  return from(batches).pipe(
                    // Finish an already-started database batch, then stop before the next one.
                    concatMap((batch) =>
                      defer(() =>
                        cancelRef.current
                          ? EMPTY
                          : Promise.allSettled(
                              batch.map((event) => Promise.resolve().then(() => eventStore.add(event))),
                            ),
                      ).pipe(
                        tap((results) => {
                          for (const result of results) {
                            if (result.status === "fulfilled" && result.value !== null) stats.added++;
                            else stats.failed++;
                          }
                        }),
                        map((): ImportProgress => ({ ...stats, isImporting: true, currentFile: file.name })),
                      ),
                    ),
                  );
                }),
                endWith(undefined),
                map((batch): ImportProgress => batch ?? { ...stats, isImporting: false, cancelled: cancelRef.current }),
                tap((state) => {
                  if (!state.isImporting && !state.cancelled) onCompleteRef.current?.(stats);
                }),
                catchError((error) =>
                  of({ ...stats, isImporting: false, error: error instanceof Error ? error.message : "Import failed" }),
                ),
                startWith({ ...stats, isImporting: true, currentFile: file.name }),
              );
            }),
          ),
          finalize(() => {
            cancelRef.current = true;
          }),
        ),
      [files$, eventStore],
    ) ?? empty;

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) files$.next(file);
    event.target.value = "";
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.jsonl"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || progress.isImporting}
      />
      <button
        onClick={() => {
          if (progress.isImporting) cancelRef.current = true;
          else fileInputRef.current?.click();
        }}
        disabled={disabled}
        className={`btn btn-soft ${progress.isImporting ? "btn-warning" : "btn-primary"} ${className}`}
      >
        {progress.isImporting ? (
          <>
            <span className="loading loading-spinner loading-sm" />
            <span className="font-mono text-sm">
              {progress.added.toLocaleString()} added / {progress.failed.toLocaleString()} failed /{" "}
              {progress.total.toLocaleString()} total — Cancel
            </span>
          </>
        ) : (
          "Import Events"
        )}
      </button>
      {progress.error && (
        <span role="alert" className="text-error">
          {progress.error}
        </span>
      )}
      {progress.cancelled && <span role="status">Import cancelled</span>}
    </>
  );
}

export type { ImportEventsButtonProps, ImportStats };
