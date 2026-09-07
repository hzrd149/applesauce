export interface Debugger {
  (...args: unknown[]): void;
  readonly namespace: string;
  readonly enabled: boolean;
  extend(segment: string): Debugger;
}

/** Structured view of a single log call, passed alongside the flat message. */
export interface LogRecord {
  /** The namespace the record was logged under. */
  namespace: string;
  /** The formatted message without the namespace prefix. */
  message: string;
  /** Milliseconds since the previous record from any namespace. */
  diff: number;
}

export type LoggerSink = (message: string, record: LogRecord) => void;

function initialNamespaces(): string {
  const process = processLike();
  if (process?.env?.DEBUG) return process.env.DEBUG;

  // Node exposes an experimental `localStorage` global that warns when touched, so only read it outside of Node
  if (process?.versions?.node) return "";

  try {
    return globalThis.localStorage?.getItem("debug") ?? "";
  } catch {
    return "";
  }
}

let namespaces = initialNamespaces();
let sink: LoggerSink = (message, record) => writeColored(message, record);

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


/** 256-color palette used when the terminal advertises extended color support. */
const EXTENDED_COLORS = [
  20, 21, 26, 27, 32, 33, 38, 39, 40, 41, 42, 43, 44, 45, 56, 57, 62, 63, 68, 69, 74, 75, 76, 77, 78, 79, 80, 81, 92,
  93, 98, 99, 112, 113, 128, 129, 134, 135, 148, 149, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172,
  173, 178, 179, 184, 185, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 214, 215, 220, 221,
];

/** Fallback palette for terminals that only support the basic ANSI colors. */
const BASIC_COLORS = [6, 2, 3, 4, 5, 1];

/** CSS colors used when logging from a browser console. */
const BROWSER_COLORS = [
  "#0000CC", "#0000FF", "#0033CC", "#0033FF", "#0066CC", "#0066FF", "#0099CC", "#0099FF", "#00CC00", "#00CC33",
  "#00CC66", "#00CC99", "#00CCCC", "#00CCFF", "#3300CC", "#3300FF", "#3333CC", "#3333FF", "#3366CC", "#3366FF",
  "#3399CC", "#3399FF", "#33CC00", "#33CC33", "#33CC66", "#33CC99", "#33CCCC", "#33CCFF", "#6600CC", "#6600FF",
  "#6633CC", "#6633FF", "#66CC00", "#66CC33", "#9900CC", "#9900FF", "#9933CC", "#9933FF", "#99CC00", "#99CC33",
  "#CC0000", "#CC0033", "#CC0066", "#CC0099", "#CC00CC", "#CC00FF", "#CC3300", "#CC3333", "#CC3366", "#CC3399",
  "#CC33CC", "#CC33FF", "#CC6600", "#CC6633", "#CC9900", "#CC9933", "#CCCC00", "#CCCC33", "#FF0000", "#FF0033",
  "#FF0066", "#FF0099", "#FF00CC", "#FF00FF", "#FF3300", "#FF3333", "#FF3366", "#FF3399", "#FF33CC", "#FF33FF",
  "#FF6600", "#FF6633", "#FF9900", "#FF9933", "#FFCC00", "#FFCC33",
];

interface ProcessLike {
  env?: Record<string, string | undefined>;
  stdout?: { isTTY?: boolean };
  versions?: { node?: string };
}

function processLike(): ProcessLike | undefined {
  try {
    return (globalThis as { process?: ProcessLike }).process;
  } catch {
    // Some browser shims expose globals through throwing accessors.
    return undefined;
  }
}

function isBrowser(): boolean {
  try {
    return typeof (globalThis as { document?: unknown }).document !== "undefined";
  } catch {
    return false;
  }
}

/** Detects whether the current environment can render colored output. */
function detectColors(): boolean {
  if (isBrowser()) return true;

  const env = processLike()?.env;
  if (!env) return false;
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false";
  if (env.TERM === "dumb") return false;
  return processLike()?.stdout?.isTTY === true;
}

/** Detects whether the terminal supports the 256-color palette. */
function detectExtendedColors(): boolean {
  const env = processLike()?.env;
  if (!env) return false;
  return /-256(color)?$/i.test(env.TERM ?? "") || env.COLORTERM !== undefined;
}

let colorsEnabled = detectColors();

export function isLoggerColorsEnabled(): boolean {
  return colorsEnabled;
}

/** Forces colored output on, regardless of environment detection. */
export function enableLoggerColors(): void {
  colorsEnabled = true;
}

/** Forces colored output off. */
export function disableLoggerColors(): void {
  colorsEnabled = false;
}

/** Picks a stable color for a namespace by hashing it, so each namespace keeps the same color. */
function selectColor<T>(namespace: string, palette: T[]): T {
  let hash = 0;
  for (let index = 0; index < namespace.length; index++) hash = ((hash << 5) - hash + namespace.charCodeAt(index)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

/** Renders a millisecond diff the way `debug` does: `+12ms`, `+3s`, `+2m`. */
function humanizeDiff(diff: number): string {
  if (diff >= 86_400_000) return `+${Math.round(diff / 86_400_000)}d`;
  if (diff >= 3_600_000) return `+${Math.round(diff / 3_600_000)}h`;
  if (diff >= 60_000) return `+${Math.round(diff / 60_000)}m`;
  if (diff >= 1_000) return `+${Math.round(diff / 1_000)}s`;
  return `+${diff}ms`;
}

/** Default sink: colors the namespace and diff, then writes to the console. */
function writeColored(message: string, record: LogRecord): void {
  const diff = humanizeDiff(record.diff);

  if (!colorsEnabled) {
    console.debug(`${message} ${diff}`);
    return;
  }

  if (isBrowser()) {
    const css = `color: ${selectColor(record.namespace, BROWSER_COLORS)}`;
    console.debug(`%c${record.namespace}%c ${record.message} %c${diff}`, css, "color: inherit", css);
    return;
  }

  const color = selectColor(record.namespace, detectExtendedColors() ? EXTENDED_COLORS : BASIC_COLORS);
  const code = `\u001B[3${color < 8 ? color : `8;5;${color}`}`;
  console.debug(`  ${code};1m${record.namespace}\u001B[0m ${record.message} ${code}m${diff}\u001B[0m`);
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

let previousTimestamp: number | undefined;

function createLogger(namespace: string): Debugger {
  const log = ((...args: unknown[]) => {
    if (!isLoggerNamespaceEnabled(namespace)) return;

    const now = Date.now();
    const diff = previousTimestamp === undefined ? 0 : now - previousTimestamp;
    previousTimestamp = now;

    const message = sanitizeRecord(format(args));
    sink(`${namespace} ${message}`, { namespace, message, diff });
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
