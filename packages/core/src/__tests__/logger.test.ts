import { afterEach, describe, expect, it } from "vitest";

import {
  disableLoggerNamespaces,
  enableLoggerNamespaces,
  getLoggerNamespaces,
  getLoggerSink,
  isLoggerNamespaceEnabled,
  logger,
  setLoggerSink,
} from "../logger.js";

const originalNamespaces = getLoggerNamespaces();
const originalSink = getLoggerSink();

afterEach(() => {
  enableLoggerNamespaces(originalNamespaces);
  setLoggerSink(originalSink);
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

  it("treats hostile percent and newline values as data", () => {
    const calls: string[] = [];
    setLoggerSink((message) => calls.push(message));
    enableLoggerNamespaces("applesauce");

    logger("challenge=%s", "%s%n\nforged");

    expect(calls).toEqual(["applesauce challenge=%s%n\nforged"]);
  });
});
