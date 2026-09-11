import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disableLoggerColors,
  disableLoggerNamespaces,
  enableLoggerColors,
  enableLoggerNamespaces,
  getLoggerNamespaces,
  getLoggerSink,
  isLoggerColorsEnabled,
  isLoggerNamespaceEnabled,
  logger,
  setLoggerSink,
} from "../logger.js";
import type { LogRecord } from "../logger.js";

const originalNamespaces = getLoggerNamespaces();
const originalSink = getLoggerSink();
const originalColors = isLoggerColorsEnabled();

afterEach(() => {
  enableLoggerNamespaces(originalNamespaces);
  setLoggerSink(originalSink);
  if (originalColors) enableLoggerColors();
  else disableLoggerColors();
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("composes child namespaces and responds to late enablement", () => {
    const calls: string[] = [];
    const child = logger.extend("child");
    setLoggerSink((message) => calls.push(message));
    disableLoggerNamespaces();

    child("silent");
    expect(child.namespace).toBe("applesauce:child");
    expect(child.enabled).toBe(false);
    expect(calls).toEqual([]);

    enableLoggerNamespaces("applesauce:child");
    expect(child.enabled).toBe(true);
    child("hello %s", "world");
    expect(calls).toEqual(["applesauce:child hello world"]);
  });

  it("applies positive wildcards and negative patterns dynamically", () => {
    enableLoggerNamespaces("applesauce:*,-applesauce:private*");

    expect(isLoggerNamespaceEnabled("applesauce:relay")).toBe(true);
    expect(isLoggerNamespaceEnabled("applesauce:relay:auth")).toBe(true);
    expect(isLoggerNamespaceEnabled("applesauce:private")).toBe(false);
    expect(isLoggerNamespaceEnabled("applesauce:private:keys")).toBe(false);

    enableLoggerNamespaces("other:* applesauce:private:keys");
    expect(isLoggerNamespaceEnabled("applesauce:relay")).toBe(false);
    expect(isLoggerNamespaceEnabled("applesauce:private:keys")).toBe(true);
  });

  it("formats observed placeholders and preserves extra arguments", () => {
    const calls: string[] = [];
    setLoggerSink((message) => calls.push(message));
    enableLoggerNamespaces("applesauce");

    logger("%s %d %o %O %j %%", "text", 42, { a: 1 }, [2], { b: true });
    logger(new Error("broken"), "extra", 7);

    expect(calls[0]).toBe('applesauce text 42 { a: 1 } [ 2 ] {"b":true} %');
    expect(calls[1]).toContain("applesauce Error: broken");
    expect(calls[1]).toContain(" extra 7");
  });

  it("does not throw while formatting hostile values", () => {
    const calls: string[] = [];
    const getter = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        throw new Error("getter exploded");
      },
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("proxy exploded");
        },
      },
    );
    const coercion = {
      toString: () => {
        throw new Error("coercion exploded");
      },
    };
    setLoggerSink((message) => calls.push(message));
    enableLoggerNamespaces("applesauce");

    expect(() => logger("%s %d %o", coercion, Symbol("x"), getter)).not.toThrow();
    expect(() => logger(proxy)).not.toThrow();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("[Unformattable] NaN { value: [Getter] }");
    expect(calls[1]).toBe("applesauce [Uninspectable]");
  });

  it("escapes record delimiters in substitutions and extra values", () => {
    const calls: string[] = [];
    setLoggerSink((message) => calls.push(message));
    enableLoggerNamespaces("applesauce");

    logger("challenge=%s", "%s%n\r\nforged", "extra\u2028forged\u2029line");

    expect(calls).toEqual(["applesauce challenge=%s%n\\r\\nforged extra\\u2028forged\\u2029line"]);
    expect(calls[0].split(/\r?\n/)).toHaveLength(1);
  });

  it("passes a structured record alongside the flat message", () => {
    const records: LogRecord[] = [];
    setLoggerSink((_message, record) => records.push(record));
    enableLoggerNamespaces("applesauce");

    logger("hello %s", "world");

    expect(records).toHaveLength(1);
    expect(records[0].namespace).toBe("applesauce");
    expect(records[0].message).toBe("hello world");
    expect(records[0].diff).toBeGreaterThanOrEqual(0);
  });

  it("colors the namespace and diff on the default sink", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    setLoggerSink(originalSink);
    enableLoggerNamespaces("applesauce");
    enableLoggerColors();

    logger("colored");

    const output = String(debugSpy.mock.calls[0][0]);
    expect(output).toContain("\u001B[");
    expect(output).toContain("applesauce");
    expect(output).toMatch(/\+\d+(ms|s|m|h|d)/);
  });

  it("gives each namespace a stable color and falls back to plain output", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    setLoggerSink(originalSink);
    enableLoggerNamespaces("applesauce:*");
    enableLoggerColors();

    const child = logger.extend("relay");
    child("one");
    child("two");
    const [first, second] = debugSpy.mock.calls.map((call) => String(call[0]).match(/\u001B\[[^m]+m/)?.[0]);
    expect(first).toBe(second);

    disableLoggerColors();
    logger.extend("relay")("three");
    expect(String(debugSpy.mock.calls[2][0])).not.toContain("\u001B[");
  });
});
