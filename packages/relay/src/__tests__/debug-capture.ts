import debugFactory from "debug";
import { format } from "node:util";

// Test-support module (not a `.test.ts` file), mirroring `fake-user.ts`'s placement convention.
//
// Two facts a future reader needs, both load-bearing:
//
// 1. `debug`'s enable state and output sink are module-level singletons shared by every test in
//    the same file (Vitest gives each *file* a fresh module registry, not each *test*). A test
//    that captures without restoring in a `finally` leaves the sink swapped and/or the namespace
//    enabled for every later test in the file — restore discipline is mandatory on every path,
//    including failure paths.
// 2. `debug`'s wildcard matching is regex-based and crosses `:`-delimited namespace segments: a
//    namespace glob ending in `*` (e.g. `applesauce:Relay:*`) also matches deeper children (e.g.
//    `applesauce:Relay:wss://foo:auth`). A broad capture will therefore also collect sub-namespace
//    lines — narrow the namespace passed to `captureDebugOutput`/`withDebugCapture` if that is
//    undesired for a given test.

/**
 * Enable `namespace` on the shared `debug` package, override its output sink with a collector,
 * and return the collected calls plus a `restore` that undoes both — putting the sink back and
 * disabling the namespace only if it was not already enabled before this call.
 */
export function captureDebugOutput(namespace: string): { calls: unknown[][]; restore: () => void } {
  const wasEnabled = debugFactory.enabled(namespace);
  debugFactory.enable(namespace);

  const originalLog = debugFactory.log;
  const calls: unknown[][] = [];
  debugFactory.log = (...args: unknown[]) => {
    calls.push(args);
  };

  return {
    calls,
    restore: () => {
      debugFactory.log = originalLog;
      if (!wasEnabled) debugFactory.disable();
    },
  };
}

/** Render each captured call through `node:util`'s `format`, matching what a real terminal shows. */
export function messagesOf(calls: unknown[][]): string[] {
  return calls.map((c) => format(...(c as [unknown, ...unknown[]])));
}

/**
 * Convenience wrapper so a test cannot forget to restore: runs `body` inside a `try`/`finally`
 * that always calls `restore`, handing `body` a getter that renders the currently captured calls.
 */
export function withDebugCapture<T>(namespace: string, body: (lines: () => string[]) => T | Promise<T>): Promise<T> {
  const { calls, restore } = captureDebugOutput(namespace);
  return Promise.resolve()
    .then(() => body(() => messagesOf(calls)))
    .finally(() => restore());
}
