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

function inspect(value: unknown, seen = new Set<unknown>()): string {
  if (value instanceof Error) return value.stack ?? value.toString();
  if (typeof value === "string") return `'${value}'`;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  if (value === null || typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  const entries = Array.isArray(value)
    ? Array.from(value, (item) => inspect(item, seen))
    : Object.entries(value).map(([key, item]) => `${key}: ${inspect(item, seen)}`);
  seen.delete(value);
  return Array.isArray(value) ? `[ ${entries.join(", ")} ]` : `{ ${entries.join(", ")} }`;
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
    if (formatter === "s") return String(value);
    if (formatter === "d") return String(Number(value));
    if (formatter === "j") return stringifyJson(value);
    return inspect(value);
  });

  const extras = rest.slice(argumentIndex).map(formatExtra);
  return extras.length > 0 ? `${message} ${extras.join(" ")}` : message;
}

function formatExtra(value: unknown): string {
  return typeof value === "string" ? value : inspect(value);
}

function createLogger(namespace: string): Debugger {
  const log = ((...args: unknown[]) => {
    if (isLoggerNamespaceEnabled(namespace)) sink(`${namespace} ${format(args)}`);
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
