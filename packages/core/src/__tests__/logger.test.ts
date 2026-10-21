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

  it("formats errors without reading or appending their stacks", () => {
    const calls: string[] = [];
    const error = new TypeError("Relay does not support NIP-77");
    const stack = vi.fn(() => "sync@http://localhost/group.js:435:39\nnext@http://localhost/rxjs.js:16:11");
    Object.defineProperty(error, "stack", { get: stack });
    setLoggerSink((message) => calls.push(message));
    enableLoggerNamespaces("applesauce");

    logger(error);
    logger("Dropped relay", error);
    logger("Failure: %o", error);
    logger({ error });

    expect(calls).toEqual([
      "applesauce TypeError: Relay does not support NIP-77",
      "applesauce Dropped relay TypeError: Relay does not support NIP-77",
      "applesauce Failure: TypeError: Relay does not support NIP-77",
      "applesauce { error: TypeError: Relay does not support NIP-77 }",
    ]);
    expect(stack).not.toHaveBeenCalled();
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

  describe("object inspection", () => {
    function capture(...args: unknown[]): string {
      const calls: string[] = [];
      setLoggerSink((message) => calls.push(message));
      enableLoggerNamespaces("applesauce");
      logger(...args);
      return calls[0];
    }

    it("expands shared references once instead of once per path", () => {
      let value: object = { leaf: true };
      for (let i = 0; i < 24; i++) value = { left: value, right: value };

      const start = performance.now();
      const message = capture("shared", value);

      expect(performance.now() - start).toBeLessThan(100);
      expect(message.length).toBeLessThan(15_000);
      expect(message).toContain("right: [Ref]");
    });

    it("marks shared siblings as references and ancestors as circular", () => {
      const shared = { id: 1 };
      const circular: Record<string, unknown> = { a: shared, b: shared };
      circular.self = circular;

      expect(capture(circular)).toBe("applesauce { a: { id: 1 }, b: [Ref], self: [Circular] }");
    });

    it("summarizes objects nested past the depth limit", () => {
      let value: object = { leaf: true };
      for (let i = 0; i < 1_000; i++) value = { next: value };

      expect(capture(value)).toBe("applesauce { next: { next: { next: { next: { next: [Object] } } } } }");
    });

    it("elides entries from large arrays and objects", () => {
      const array = Array.from({ length: 100_000 }, (_, i) => i);
      const object = Object.fromEntries(array.map((i) => [`key${i}`, i]));

      expect(capture(array)).toMatch(/, 49, \.\.\. 99950 more \]$/);
      expect(capture(object)).toMatch(/key49: 49, \.\.\. }$/);
    });

    it("stops traversal once the output budget is spent", () => {
      const wide = Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => "x".repeat(100)));

      expect(capture(wide).length).toBeLessThan(15_000);
    });

    it("summarizes DOM-like host objects without walking their internals", () => {
      class HTMLDivElement extends EventTarget {}
      const element = new HTMLDivElement();
      const fiber = vi.fn(() => ({}));
      Object.defineProperty(element, "__reactFiber$abc", { enumerable: true, get: fiber });
      Object.assign(element, { __reactProps$abc: { children: [element] } });

      expect(capture("container %o", element)).toBe("applesauce container [HTMLDivElement]");
      expect(capture({ ref: element })).toBe("applesauce { ref: [HTMLDivElement] }");
      expect(fiber).not.toHaveBeenCalled();
    });

    it("reports getters without invoking them", () => {
      const getter = vi.fn(() => 1);
      const value = Object.defineProperty({}, "lazy", { enumerable: true, get: getter });

      expect(capture(value)).toBe("applesauce { lazy: [Getter] }");
      expect(getter).not.toHaveBeenCalled();
    });

    it("does not inspect arguments when the namespace is disabled", () => {
      const calls: string[] = [];
      const ownKeys = vi.fn(() => []);
      setLoggerSink((message) => calls.push(message));
      disableLoggerNamespaces();

      logger("value %o", new Proxy({}, { ownKeys }));

      expect(calls).toEqual([]);
      expect(ownKeys).not.toHaveBeenCalled();
    });
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
