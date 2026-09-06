export interface Debugger {
  (...args: unknown[]): void;
  readonly namespace: string;
  readonly enabled: boolean;
  extend(segment: string): Debugger;
}

export type LoggerSink = (message: string) => void;

function initialNamespaces(): string {
  try {
    const processValue = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    if (processValue?.env?.DEBUG) return processValue.env.DEBUG;
  } catch {
    // Some browser shims expose globals through throwing accessors.
  }

  try {
    return globalThis.localStorage?.getItem("debug") ?? "";
  } catch {
    return "";
  }
}

let namespaces = initialNamespaces();
let sink: LoggerSink = (message) => console.debug(message);

function patternToRegExp(pattern: string): RegExp {
  const source = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${source}$`);
}

function namespacePatterns(): { include: RegExp[]; exclude: RegExp[] } {
  const include: RegExp[] = [];
  const exclude: RegExp[] = [];

  for (const pattern of namespaces.split(/[\s,]+/).filter(Boolean)) {
    if (pattern.startsWith("-")) exclude.push(patternToRegExp(pattern.slice(1)));
    else include.push(patternToRegExp(pattern));
  }

  return { include, exclude };
}

export function isLoggerNamespaceEnabled(namespace: string): boolean {
  const patterns = namespacePatterns();
  return !patterns.exclude.some((pattern) => pattern.test(namespace)) &&
    patterns.include.some((pattern) => pattern.test(namespace));
}

export function enableLoggerNamespaces(patterns: string): void {
  namespaces = patterns;
}

export function disableLoggerNamespaces(): void {
  namespaces = "";
}

export function getLoggerNamespaces(): string {
  return namespaces;
}

export function getLoggerSink(): LoggerSink {
  return sink;
}

export function setLoggerSink(nextSink: LoggerSink): void {
  sink = nextSink;
}

function safeString(value: unknown, fallback = "[Unformattable]"): string {
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function inspect(value: unknown, seen = new Set<unknown>()): string {
  try {
    if (value instanceof Error) return value.stack ?? safeString(value);
    if (typeof value === "string") return `'${value}'`;
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "symbol" || typeof value === "function") return safeString(value);
    if (value === null || typeof value !== "object") return safeString(value);
    if (seen.has(value)) return "[Circular]";

    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = Object.entries(descriptors)
      .filter(([key, descriptor]) => key !== "length" && descriptor.enumerable)
      .map(([key, descriptor]) => {
        const item = "value" in descriptor ? inspect(descriptor.value, seen) : "[Getter]";
        return Array.isArray(value) ? item : `${key}: ${item}`;
      });
    seen.delete(value);
    return Array.isArray(value) ? `[ ${entries.join(", ")} ]` : `{ ${entries.join(", ")} }`;
  } catch {
    seen.delete(value);
    return "[Uninspectable]";
  }
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[Circular]";
  }
}

function format(args: unknown[]): string {
  if (args.length === 0) return "";
  const [first, ...rest] = args;
  if (typeof first !== "string") return [inspect(first), ...rest.map(formatExtra)].join(" ");

  let argumentIndex = 0;
  const message = first.replace(/%([sdjoO%])/g, (token, formatter: string) => {
    if (formatter === "%") return "%";
    if (argumentIndex >= rest.length) return token;
    const value = rest[argumentIndex++];
    if (formatter === "s") return safeString(value);
    if (formatter === "d") {
      try {
        return String(Number(value));
      } catch {
        return "NaN";
      }
    }
    if (formatter === "j") return stringifyJson(value);
    return inspect(value);
  });

  const extras = rest.slice(argumentIndex).map(formatExtra);
  return extras.length > 0 ? `${message} ${extras.join(" ")}` : message;
}

function formatExtra(value: unknown): string {
  return typeof value === "string" ? value : inspect(value);
}

function sanitizeRecord(message: string): string {
  return message.replace(/[\r\n\u2028\u2029]/g, (character) => {
    if (character === "\r") return "\\r";
    if (character === "\n") return "\\n";
    if (character === "\u2028") return "\\u2028";
    return "\\u2029";
  });
}

function createLogger(namespace: string): Debugger {
  const log = ((...args: unknown[]) => {
    if (isLoggerNamespaceEnabled(namespace)) sink(`${namespace} ${sanitizeRecord(format(args))}`);
  }) as Debugger;

  Object.defineProperties(log, {
    namespace: { value: namespace, enumerable: true },
    enabled: { get: () => isLoggerNamespaceEnabled(namespace), enumerable: true },
  });
  log.extend = (segment) => createLogger(`${namespace}:${segment}`);
  return log;
}

/** Root logger for all Applesauce packages. */
export const logger = createLogger("applesauce");
