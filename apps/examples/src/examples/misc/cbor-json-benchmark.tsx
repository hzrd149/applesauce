import { NostrEvent, isEvent } from "applesauce-core/helpers";
import { ChangeEvent, useRef, useState } from "react";
import { encodeCBOR, decodeCBOR } from "applesauce-core/helpers/cbor";

type BenchmarkResult = {
  operation: string;
  avgTimePerOp: number; // milliseconds
  totalTime: number; // milliseconds
  throughput: number; // events per second
  size?: number; // bytes
};

type BenchmarkResults = {
  encodeJSON: BenchmarkResult;
  encodeCBOR: BenchmarkResult;
  decodeJSON: BenchmarkResult;
  decodeCBOR: BenchmarkResult;
};

// Parse JSONL file into events array
async function parseJsonlFile(file: File): Promise<NostrEvent[]> {
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());
  const events: NostrEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const event = JSON.parse(line);
      if (isEvent(event)) {
        events.push(event);
      } else {
        console.warn(`Invalid event at line ${i + 1}`);
      }
    } catch (parseError) {
      console.error(`Failed to parse JSON at line ${i + 1}:`, parseError);
    }
  }

  return events;
}

// Benchmark JSON encoding
async function benchmarkEncodeJSON(events: NostrEvent[], iterations: number): Promise<BenchmarkResult> {
  const start = performance.now();
  const batchSize = 1000;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      for (const event of batch) {
        JSON.stringify(event);
      }
      // Yield to event loop every batch
      if (i + batchSize < events.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgTimePerOp = totalTime / (events.length * iterations);
  const throughput = (events.length * iterations) / (totalTime / 1000);

  // Calculate size (only for first iteration)
  let totalSize = 0;
  for (const event of events) {
    totalSize += new TextEncoder().encode(JSON.stringify(event)).length;
  }

  return {
    operation: "Encode to JSON",
    avgTimePerOp,
    totalTime: totalTime / iterations, // Average total time per run
    throughput,
    size: totalSize,
  };
}

// Benchmark CBOR encoding
async function benchmarkEncodeCBOR(events: NostrEvent[], iterations: number): Promise<BenchmarkResult> {
  const start = performance.now();
  const batchSize = 1000;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      for (const event of batch) {
        encodeCBOR(event);
      }
      // Yield to event loop every batch
      if (i + batchSize < events.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgTimePerOp = totalTime / (events.length * iterations);
  const throughput = (events.length * iterations) / (totalTime / 1000);

  // Calculate size (only for first iteration)
  let totalSize = 0;
  for (const event of events) {
    totalSize += encodeCBOR(event).length;
  }

  return {
    operation: "Encode to CBOR",
    avgTimePerOp,
    totalTime: totalTime / iterations, // Average total time per run
    throughput,
    size: totalSize,
  };
}

// Benchmark JSON decoding
async function benchmarkDecodeJSON(jsonStrings: string[], iterations: number): Promise<BenchmarkResult> {
  const start = performance.now();
  const batchSize = 1000;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < jsonStrings.length; i += batchSize) {
      const batch = jsonStrings.slice(i, i + batchSize);
      for (const jsonStr of batch) {
        JSON.parse(jsonStr);
      }
      // Yield to event loop every batch
      if (i + batchSize < jsonStrings.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgTimePerOp = totalTime / (jsonStrings.length * iterations);
  const throughput = (jsonStrings.length * iterations) / (totalTime / 1000);

  return {
    operation: "Decode from JSON",
    avgTimePerOp,
    totalTime: totalTime / iterations,
    throughput,
  };
}

// Benchmark CBOR decoding
async function benchmarkDecodeCBOR(cborBuffers: Uint8Array[], iterations: number): Promise<BenchmarkResult> {
  const start = performance.now();
  const batchSize = 1000;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < cborBuffers.length; i += batchSize) {
      const batch = cborBuffers.slice(i, i + batchSize);
      for (const buffer of batch) {
        const decoded = decodeCBOR(buffer);
        // Validate that decoded value is a valid event
        if (!isEvent(decoded)) {
          throw new Error("Decoded CBOR is not a valid NostrEvent");
        }
      }
      // Yield to event loop every batch
      if (i + batchSize < cborBuffers.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgTimePerOp = totalTime / (cborBuffers.length * iterations);
  const throughput = (cborBuffers.length * iterations) / (totalTime / 1000);

  return {
    operation: "Decode from CBOR",
    avgTimePerOp,
    totalTime: totalTime / iterations,
    throughput,
  };
}

// Format number with commas and 2 decimal places
function formatNumber(num: number): string {
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Format bytes
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function CborJsonBenchmark() {
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [results, setResults] = useState<BenchmarkResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".jsonl")) {
      setError("Please select a .jsonl file");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);
    setFileName(file.name);

    try {
      const parsedEvents = await parseJsonlFile(file);
      if (parsedEvents.length === 0) {
        setError("No valid events found in the file");
        setIsLoading(false);
        return;
      }
      setEvents(parsedEvents);
    } catch (err) {
      console.error("Failed to parse file:", err);
      setError(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setIsLoading(false);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const runBenchmark = async () => {
    if (events.length === 0) {
      setError("No events loaded. Please select a file first.");
      return;
    }

    setIsBenchmarking(true);
    setError(null);

    // Use a small delay to allow UI to update
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const iterations = 10; // Run 10 iterations for accuracy

      // Encode events to JSON
      const encodeJSONResult = await benchmarkEncodeJSON(events, iterations);

      // Encode events to CBOR
      const encodeCBORResult = await benchmarkEncodeCBOR(events, iterations);

      // Prepare data for decoding benchmarks
      const jsonStrings = events.map((event) => JSON.stringify(event));
      const cborBuffers = events.map((event) => encodeCBOR(event));

      // Decode from JSON
      const decodeJSONResult = await benchmarkDecodeJSON(jsonStrings, iterations);

      // Decode from CBOR
      const decodeCBORResult = await benchmarkDecodeCBOR(cborBuffers, iterations);

      setResults({
        encodeJSON: encodeJSONResult,
        encodeCBOR: encodeCBORResult,
        decodeJSON: decodeJSONResult,
        decodeCBOR: decodeCBORResult,
      });
    } catch (err) {
      console.error("Benchmark failed:", err);
      setError(err instanceof Error ? err.message : "Benchmark failed");
    } finally {
      setIsBenchmarking(false);
    }
  };

  const handleReset = () => {
    setEvents([]);
    setFileName("");
    setResults(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const sizeSavings = results
    ? ((results.encodeJSON.size! - results.encodeCBOR.size!) / results.encodeJSON.size!) * 100
    : 0;

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">CBOR vs JSON Performance Benchmark</h1>
        <p className="text-base-content/70">
          Compare encoding and decoding performance between JSON and CBOR formats for Nostr events.
        </p>
      </div>

      {/* File Selection */}
      <div className="card bg-base-100 shadow-md mb-6">
        <div className="card-body">
          <h2 className="card-title text-xl mb-4">1. Select Events File</h2>
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isLoading || isBenchmarking}
            />
            <button
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isBenchmarking}
            >
              {isLoading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Loading...
                </>
              ) : (
                "Select .jsonl File"
              )}
            </button>
            {fileName && (
              <div className="flex-1">
                <span className="text-sm text-base-content/70">Selected: </span>
                <span className="font-mono text-sm">{fileName}</span>
                <span className="text-sm text-base-content/70 ml-2">({events.length.toLocaleString()} events)</span>
              </div>
            )}
            {events.length > 0 && (
              <button className="btn btn-outline btn-sm" onClick={handleReset}>
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="alert alert-error mb-6">
          <span>{error}</span>
        </div>
      )}

      {/* Benchmark Button */}
      {events.length > 0 && !results && (
        <div className="card bg-base-100 shadow-md mb-6">
          <div className="card-body">
            <h2 className="card-title text-xl mb-4">2. Run Benchmark</h2>
            <button className="btn btn-primary btn-lg" onClick={runBenchmark} disabled={isBenchmarking}>
              {isBenchmarking ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Running Benchmark...
                </>
              ) : (
                "Start Benchmark"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h2 className="card-title text-xl mb-4">3. Results</h2>

            {/* Size Comparison */}
            {results.encodeJSON.size && results.encodeCBOR.size && (
              <div className="alert alert-info mb-6">
                <div className="flex flex-col gap-2">
                  <div>
                    <span className="font-semibold">JSON Size: </span>
                    {formatBytes(results.encodeJSON.size)}
                  </div>
                  <div>
                    <span className="font-semibold">CBOR Size: </span>
                    {formatBytes(results.encodeCBOR.size)}
                  </div>
                  <div>
                    <span className="font-semibold">Size Savings: </span>
                    <span className={sizeSavings > 0 ? "text-success" : "text-error"}>
                      {sizeSavings > 0 ? "-" : "+"}
                      {Math.abs(sizeSavings).toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Results Table */}
            <div className="overflow-x-auto">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th className="text-right">Avg Time/Op (ms)</th>
                    <th className="text-right">Total Time (ms)</th>
                    <th className="text-right">Throughput (ops/sec)</th>
                    {results.encodeJSON.size && <th className="text-right">Size</th>}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">{results.encodeJSON.operation}</td>
                    <td className="text-right font-mono">{formatNumber(results.encodeJSON.avgTimePerOp)}</td>
                    <td className="text-right font-mono">{formatNumber(results.encodeJSON.totalTime)}</td>
                    <td className="text-right font-mono">{formatNumber(results.encodeJSON.throughput)}</td>
                    {results.encodeJSON.size && (
                      <td className="text-right font-mono">{formatBytes(results.encodeJSON.size)}</td>
                    )}
                  </tr>
                  <tr>
                    <td className="font-semibold">{results.encodeCBOR.operation}</td>
                    <td className="text-right font-mono">{formatNumber(results.encodeCBOR.avgTimePerOp)}</td>
                    <td className="text-right font-mono">{formatNumber(results.encodeCBOR.totalTime)}</td>
                    <td className="text-right font-mono">{formatNumber(results.encodeCBOR.throughput)}</td>
                    {results.encodeCBOR.size && (
                      <td className="text-right font-mono">{formatBytes(results.encodeCBOR.size)}</td>
                    )}
                  </tr>
                  <tr>
                    <td className="font-semibold">{results.decodeJSON.operation}</td>
                    <td className="text-right font-mono">{formatNumber(results.decodeJSON.avgTimePerOp)}</td>
                    <td className="text-right font-mono">{formatNumber(results.decodeJSON.totalTime)}</td>
                    <td className="text-right font-mono">{formatNumber(results.decodeJSON.throughput)}</td>
                    {results.decodeJSON.size && (
                      <td className="text-right font-mono">{formatBytes(results.decodeJSON.size)}</td>
                    )}
                  </tr>
                  <tr>
                    <td className="font-semibold">{results.decodeCBOR.operation}</td>
                    <td className="text-right font-mono">{formatNumber(results.decodeCBOR.avgTimePerOp)}</td>
                    <td className="text-right font-mono">{formatNumber(results.decodeCBOR.totalTime)}</td>
                    <td className="text-right font-mono">{formatNumber(results.decodeCBOR.throughput)}</td>
                    {results.decodeCBOR.size && (
                      <td className="text-right font-mono">{formatBytes(results.decodeCBOR.size)}</td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Comparison Summary */}
            <div className="mt-6 p-4 bg-base-200 rounded-lg">
              <h3 className="font-semibold mb-2">Performance Comparison</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Encoding: </span>
                  {results.encodeCBOR.totalTime < results.encodeJSON.totalTime ? (
                    <span className="text-success">
                      CBOR is {((results.encodeJSON.totalTime / results.encodeCBOR.totalTime - 1) * 100).toFixed(1)}%
                      faster
                    </span>
                  ) : (
                    <span className="text-error">
                      JSON is {((results.encodeCBOR.totalTime / results.encodeJSON.totalTime - 1) * 100).toFixed(1)}%
                      faster
                    </span>
                  )}
                </div>
                <div>
                  <span className="font-semibold">Decoding: </span>
                  {results.decodeCBOR.totalTime < results.decodeJSON.totalTime ? (
                    <span className="text-success">
                      CBOR is {((results.decodeJSON.totalTime / results.decodeCBOR.totalTime - 1) * 100).toFixed(1)}%
                      faster
                    </span>
                  ) : (
                    <span className="text-error">
                      JSON is {((results.decodeCBOR.totalTime / results.decodeJSON.totalTime - 1) * 100).toFixed(1)}%
                      faster
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Run Again Button */}
            <div className="mt-4">
              <button className="btn btn-outline" onClick={runBenchmark} disabled={isBenchmarking}>
                {isBenchmarking ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Running...
                  </>
                ) : (
                  "Run Benchmark Again"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
