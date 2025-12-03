import { IAsyncEventStore, IEventStore } from "applesauce-core";
import { isEvent } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers";
import { ChangeEvent, useRef, useState } from "react";

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
}

export default function ImportEventsButton({
  eventStore,
  onImportComplete,
  className = "",
  disabled = false,
}: ImportEventsButtonProps) {
  const [progress, setProgress] = useState<ImportProgress>({
    total: 0,
    added: 0,
    failed: 0,
    isImporting: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<boolean>(false);

  const addEventToStore = async (event: NostrEvent): Promise<boolean> => {
    try {
      const inserted = await eventStore.add(event);
      if (inserted === null) false;
      return true;
    } catch (error) {
      console.error("Failed to add event:", error);
      return false;
    }
  };

  const processBatchOfEvents = async (events: NostrEvent[]): Promise<{ added: number; failed: number }> => {
    let added = 0;
    let failed = 0;

    await Promise.all(
      events.map(async (event) => {
        const success = await addEventToStore(event);
        if (success) added++;
        else failed++;
      }),
    );

    return { added, failed };
  };

  const processJsonArrayFile = async (file: File) => {
    const stats: ImportStats = { total: 0, added: 0, failed: 0 };
    cancelRef.current = false;

    setProgress({
      ...stats,
      isImporting: true,
      currentFile: file.name,
      cancelled: false,
    });

    try {
      const text = await file.text();

      // Parse the entire JSON array
      let eventsArray: any[];
      try {
        eventsArray = JSON.parse(text);
      } catch (parseError) {
        console.error("Failed to parse JSON array:", parseError);
        setProgress({
          ...stats,
          isImporting: false,
        });
        return;
      }

      if (!Array.isArray(eventsArray)) {
        console.error("File content is not a JSON array");
        setProgress({
          ...stats,
          isImporting: false,
        });
        return;
      }

      stats.total = eventsArray.length;

      // Validate all events first, collecting valid ones
      const validEvents: NostrEvent[] = [];
      let parseFailures = 0;

      for (let i = 0; i < eventsArray.length; i++) {
        const event = eventsArray[i];

        if (!isEvent(event)) {
          console.warn(`Invalid event at index ${i}:`, event);
          parseFailures++;
          continue;
        }

        validEvents.push(event);
      }

      stats.failed = parseFailures;

      // Process events in batches of 100
      const batchSize = 100;
      for (let batchStart = 0; batchStart < validEvents.length; batchStart += batchSize) {
        // Check for cancellation
        if (cancelRef.current) {
          setProgress({
            ...stats,
            isImporting: false,
            cancelled: true,
          });
          return;
        }

        const batchEnd = Math.min(batchStart + batchSize, validEvents.length);
        const batch = validEvents.slice(batchStart, batchEnd);

        const { added: batchAdded, failed: batchFailed } = await processBatchOfEvents(batch);
        stats.added += batchAdded;
        stats.failed += batchFailed;

        // Update progress after each batch
        setProgress({
          ...stats,
          isImporting: true,
          currentFile: file.name,
          cancelled: false,
        });

        // Allow UI to update
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.error("Failed to process file:", error);
      setProgress({
        ...stats,
        isImporting: false,
      });
      return;
    }

    setProgress({
      ...stats,
      isImporting: false,
    });

    onImportComplete?.(stats);
  };

  const processJsonlFile = async (file: File) => {
    const stats: ImportStats = { total: 0, added: 0, failed: 0 };
    cancelRef.current = false;

    setProgress({
      ...stats,
      isImporting: true,
      currentFile: file.name,
      cancelled: false,
    });

    try {
      const text = await file.text();
      const lines = text.split("\n").filter((line) => line.trim());
      stats.total = lines.length;

      // Parse all events first, collecting valid ones
      const validEvents: NostrEvent[] = [];
      let parseFailures = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const event = JSON.parse(line);

          if (!isEvent(event)) {
            console.warn(`Invalid event at line ${i + 1}:`, event);
            parseFailures++;
            continue;
          }

          validEvents.push(event);
        } catch (parseError) {
          console.error(`Failed to parse JSON at line ${i + 1}:`, parseError);
          parseFailures++;
        }
      }

      stats.failed = parseFailures;

      // Process events in batches of 100
      const batchSize = 100;
      for (let batchStart = 0; batchStart < validEvents.length; batchStart += batchSize) {
        // Check for cancellation
        if (cancelRef.current) {
          setProgress({
            ...stats,
            isImporting: false,
            cancelled: true,
          });
          return;
        }

        const batchEnd = Math.min(batchStart + batchSize, validEvents.length);
        const batch = validEvents.slice(batchStart, batchEnd);

        const { added: batchAdded, failed: batchFailed } = await processBatchOfEvents(batch);
        stats.added += batchAdded;
        stats.failed += batchFailed;

        // Update progress after each batch
        setProgress({
          ...stats,
          isImporting: true,
          currentFile: file.name,
          cancelled: false,
        });

        // Allow UI to update
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.error("Failed to process file:", error);
      setProgress({
        ...stats,
        isImporting: false,
      });
      return;
    }

    setProgress({
      ...stats,
      isImporting: false,
    });

    onImportComplete?.(stats);
  };

  const processFile = async (file: File) => {
    try {
      const text = await file.text();
      const firstChar = text.trim().charAt(0);

      if (firstChar === "[") {
        // JSON array format
        processJsonArrayFile(file);
      } else {
        // JSONL format (each line is a JSON object)
        processJsonlFile(file);
      }
    } catch (error) {
      console.error("Failed to read file:", error);
      alert("Failed to read the selected file");
    }
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".json") && !file.name.endsWith(".jsonl")) {
      alert("Please select a .json or .jsonl file");
      return;
    }

    processFile(file);

    // Reset file input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleButtonClick = () => {
    if (progress.isImporting) {
      // Cancel the import
      cancelRef.current = true;
    } else {
      // Start new import
      fileInputRef.current?.click();
    }
  };

  const formatNumber = (num: number) => num.toLocaleString();

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
        onClick={handleButtonClick}
        disabled={disabled}
        className={`btn btn-soft ${progress.isImporting ? "btn-warning" : "btn-primary"} ${className}`}
      >
        {progress.isImporting ? (
          <div className="flex items-center gap-2">
            <span className="loading loading-spinner loading-sm"></span>
            <span className="font-mono text-sm">
              {progress.total > 0 ? (
                <span className="flex items-center gap-1">
                  <span className="text-success">{formatNumber(progress.added)}</span>
                  <span>/</span>
                  <span className="text-error">{formatNumber(progress.failed)}</span>
                  <span>/</span>
                  <span>{formatNumber(progress.total)}</span>
                  <span className="ml-1">
                    ({Math.round(((progress.added + progress.failed) / progress.total) * 100)}%)
                  </span>
                </span>
              ) : (
                "Starting..."
              )}
            </span>
          </div>
        ) : (
          "Import Events"
        )}
      </button>
    </>
  );
}

export type { ImportEventsButtonProps, ImportStats };
