import { mergeRelaySets, normalizeRelayUrl } from "../relays.js";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeURL,
  serializeURL,
  getURLPathname,
  getURLHostname,
  getURLFilename,
  ensureWebSocketURL,
  ensureHttpURL,
  isImageURL,
  isVideoURL,
  isAudioURL,
  isStreamURL,
} from "../url.js";

// Keep this independent of the fast path: this is the pre-optimization contract.
function nativeNormalize(input: string | URL): string | URL {
  const url = new URL(input);
  const path = url.pathname;
  if (path === "" || path.includes("//")) url.pathname = path.replace(/\/{2,}/g, "/");
  return typeof input === "string" ? url.toString() : url;
}

function outcome(normalize: (input: string) => unknown, input: string) {
  try {
    return { value: String(normalize(input)) };
  } catch (error) {
    return { error: error instanceof Error ? error.name : String(error) };
  }
}

function nativeProtocol(input: string, websocket: boolean): string {
  const protocol = websocket ? "wss:" : "http:";
  const url = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(input) ? input : protocol + "//" + input);
  if (websocket) {
    if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol !== "ws:") url.protocol = "wss:";
  } else {
    if (url.protocol === "ws:") url.protocol = "http:";
    else if (url.protocol === "wss:") url.protocol = "https:";
    else if (url.protocol !== "http:") url.protocol = "https:";
  }
  return url.href;
}

function nativeFilename(input: string): string | undefined {
  const url = new URL(input);
  return url.pathname.split("/").pop()?.toLocaleLowerCase() || url.searchParams.get("filename")?.toLocaleLowerCase();
}

function nativeRelay(input: string): string {
  const trimmed = input.trim();
  if (/[\s\x00-\x1f\x7f]/.test(trimmed)) throw new Error("Relay URL contains whitespace");
  const result = String(nativeNormalize(nativeProtocol(trimmed, true)));
  const url = new URL(result);
  if ((url.protocol !== "ws:" && url.protocol !== "wss:") || !url.hostname) throw new Error("Not a WebSocket URL");
  return result;
}

const comparisons: [string, (input: string) => unknown, (input: string) => unknown][] = [
  ["normalize", normalizeURL, nativeNormalize],
  ["relay", normalizeRelayUrl, nativeRelay],
  ["serialize", serializeURL, (input) => new URL(input).href],
  ["pathname", getURLPathname, (input) => new URL(input).pathname],
  ["hostname", getURLHostname, (input) => new URL(input).hostname],
  ["filename", getURLFilename, nativeFilename],
  ["websocket", ensureWebSocketURL, (input) => nativeProtocol(input, true)],
  ["http", ensureHttpURL, (input) => nativeProtocol(input, false)],
];
for (const [name, check, extensions] of [
  ["image", isImageURL, [".svg", ".gif", ".png", ".jpg", ".jpeg", ".webp", ".avif"]],
  ["video", isVideoURL, [".mp4", ".mkv", ".webm", ".mov"]],
  ["stream", isStreamURL, [".m3u8"]],
  ["audio", isAudioURL, [".mp3", ".wav", ".ogg", ".aac", ".m4a"]],
] as const) {
  comparisons.push([
    name,
    check,
    (input) => {
      try {
        const filename = nativeFilename(input);
        return !!filename && extensions.some((ext) => filename.endsWith(ext));
      } catch {
        return false;
      }
    },
  ]);
}

function compare(inputs: Iterable<string>) {
  for (const input of inputs)
    for (const [name, actual, expected] of comparisons)
      expect(outcome(actual, input), name + " " + JSON.stringify(input)).toEqual(outcome(expected, input));
}

describe("URL helper native compatibility", { timeout: 20000 }, () => {
  const hosts = [
    "relay.example.com",
    "LOCALHOST",
    "example.com.",
    "foo_bar.example",
    "-a..b",
    "a~b.example",
    "bücher.example",
    "xn--bcher-kva.example",
    "xn--invalid-",
    "[::1]",
    "[2001:0db8::1]",
    "[::ffff:192.0.2.1]",
    "[invalid]",
    "127.0.0.1",
    "127.1",
    "0177.0.0.1",
    "0x7f000001",
    "test.42",
    "foo.0x",
    "0x.0x.0x.0x",
    "%65xample.com",
    "user:pass@example.com",
    "",
  ];
  const ports = ["", ":", ":0", ":80", ":443", ":00443", ":000080", ":8080", ":65535", ":65536", ":-1", ":abc"];
  const paths = [
    "",
    "/",
    "//a///b",
    "/a/./b",
    "/a/../b",
    "/a/%2e%2e/b",
    "/a/.%2E/b",
    "/a/%2e./b",
    "/a/%2e/b",
    "/a%2F%2Fb",
    "/a\\b",
    "/a?q=//#//",
    "/a?x='y",
    "/a?#",
    "/hello world",
    "/é",
    "/a/%zz",
    "/a#one#two",
    "/a\n",
    "/a\t?b\r",
    '/a?x=<>`"#<>`"',
  ];

  for (const scheme of ["wss", "ws", "WSS", "https", "HTTP", "ftp", "custom"]) {
    it(`matches the native parser for ${scheme} hosts, ports, paths and invalid inputs`, () => {
      function* inputs() {
        for (const host of hosts)
          for (const port of ports) for (const path of paths) yield `${scheme}://${host}${port}${path}`;
      }
      compare(inputs());
    });
  }

  it("matches unusual schemes, whitespace and malformed authorities", () => {
    compare([
      "",
      "not a url",
      " relay.example.com ",
      " wss://EXAMPLE.com/a//b ",
      "\0wss://example.com/\0",
      "wss:example.com",
      "wss:/example.com",
      "wss:////example.com//a",
      "wss:\\example.com\\a",
      "w\nss://example.com/",
      "wss://example.com/ wss://other.com/",
      "wss://user@@example.com/",
      "wss://user:p%40ss@example.com//a",
      "wss://example.com:000000000443/",
      "wss://example.com/#",
      "mailto:a//b@example.com",
      "data:text/plain,a//b",
      "nostr:abc",
      "javascript:alert(1)",
      "file:///tmp//a",
      "file://localhost/C:/a/../b",
      "custom://",
      "custom:///",
      "custom:a//b",
    ]);
  });

  it("matches every ASCII character in each URL component", () => {
    function* inputs() {
      for (let code = 0; code < 128; code++) {
        const char = String.fromCharCode(code);
        yield `wss://a${char}b.example/`;
        yield `wss://example.com:4${char}3/`;
        yield `wss://example.com/a${char}b//c`;
        yield `wss://example.com/?a${char}b`;
        yield `wss://example.com/#a${char}b`;
      }
    }
    compare(inputs());
  });

  it("matches deterministic mutations of ordinary URLs", () => {
    let seed = 0x12345678;
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    const characters = "abcXYZ012.-_%:/\\?#@[]\t\n '\"é";
    function* inputs() {
      for (let i = 0; i < 5000; i++) {
        let input = "wss://relay.example.com:443/a//b?x=1#two";
        for (let edit = 0, count = 1 + random(4); edit < count; edit++) {
          const offset = random(input.length + 1);
          input = input.slice(0, offset) + characters[random(characters.length)] + input.slice(offset + random(2));
        }
        yield input;
      }
    }
    compare(inputs());
  });

  it("matches percent-encoded bytes without decoding paths, queries or fragments", () => {
    function* inputs() {
      for (let byte = 0; byte < 256; byte++) {
        const escape = "%" + byte.toString(16).padStart(2, "0");
        yield `wss://a${escape}b.example/`;
        yield `wss://example.com/a${escape}b//c`;
        yield `wss://example.com/?a${escape}b`;
        yield `wss://example.com/#a${escape}b`;
      }
      for (const dot of [".", "%2e", "%2E"])
        for (const second of ["", ".", "%2e", "%2E"])
          for (const suffix of ["", "/", "//b", "?q=//#//"]) yield `wss://example.com/a//${dot}${second}${suffix}`;
    }
    compare(inputs());
  });

  it("preserves filename precedence and query decoding", () => {
    compare([
      "https://example.com/image.JPG?filename=wrong.mp4",
      "https://example.com/?filename=hello+world%2Emp4",
      "https://example.com/?filename=&filename=second.png",
      "https://example.com/?filename=one.png&filename=two.mp4",
      "https://example.com/#?filename=wrong.png",
      "https://example.com/?filename=%FF.png",
      "https://example.com/a%2Fb.MP4",
      "https://example.com/a/../?filename=image.png",
      "https://example.com/video.mp4",
      "https://example.com/audio.MP3",
      "https://example.com/stream.m3u8",
      "example.com/a//b?filename=test.mp4",
      "localhost:8080/a",
      "[::1]/a",
    ]);
  });

  it("reuses cached simple parsing and safely evicts old entries", () => {
    const nativeExec = RegExp.prototype.exec;
    let parses = 0;
    const spy = vi.spyOn(RegExp.prototype, "exec").mockImplementation(function (this: RegExp, input: string) {
      if (this.source.startsWith("^(wss?|https?)")) parses++;
      return nativeExec.call(this, input);
    });
    try {
      const input = "wss://cache-regression.example/a//b?x=1#two";
      expect(normalizeURL(input)).toBe("wss://cache-regression.example/a/b?x=1#two");
      const count = parses;
      for (let i = 0; i < 100; i++) {
        normalizeURL(input);
        serializeURL(input);
        getURLPathname(input);
        getURLHostname(input);
        getURLFilename(input);
      }
      expect(parses).toBe(count);
      for (let i = 0; i < 1100; i++) serializeURL(`wss://eviction-${i}.example/a`);
      const before = parses;
      expect(normalizeURL(input)).toBe("wss://cache-regression.example/a/b?x=1#two");
      expect(parses).toBe(before + 1);
      const large = "https://example.com/" + "a".repeat(5000);
      expect(serializeURL(large)).toBe(large);
      const after = parses;
      serializeURL(large);
      expect(parses).toBe(after + 1);
    } finally {
      spy.mockRestore();
    }
  });

  it("deduplicates before parsing while preserving relay order and invalid-input handling", () => {
    const inputs = [
      "wss://bücher.dedup.example/",
      "wss://bücher.dedup.example/",
      "WSS://EXAMPLE.com:443/",
      "wss://example.com/",
      "not a url",
      "not a url",
      "ws://localhost:8080/",
    ];
    const expected = new Set<string>();
    for (const input of inputs) {
      try {
        expected.add(nativeRelay(input));
      } catch {
        /* Ignore invalid relays. */
      }
    }
    const NativeURL = globalThis.URL;
    const constructor = vi.fn(function (input: string | URL) {
      return new NativeURL(input);
    });
    vi.stubGlobal("URL", constructor);
    try {
      expect(mergeRelaySets(inputs, new Set(inputs), ...inputs)).toEqual([...expected]);
      // One Unicode input needs conversion and normalization; its duplicates are skipped.
      // The invalid whitespace input is rejected before native parsing.
      expect(constructor).toHaveBeenCalledTimes(2);
      constructor.mockClear();
      expect(mergeRelaySets(Array(100).fill("https://zero-constructor.example/a//b"))).toEqual([
        "wss://zero-constructor.example/a/b",
      ]);
      expect(constructor).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps recently used results through LRU churn and caches native fallback conversions", () => {
    const NativeURL = globalThis.URL;
    const constructor = vi.fn(function (input: string | URL) {
      return new NativeURL(input);
    });
    vi.stubGlobal("URL", constructor);
    try {
      const hot = "wss://bücher.lru-hot.example/a//b";
      const cold = "wss://bücher.lru-cold.example/a//b";
      normalizeURL(hot);
      normalizeURL(cold);
      constructor.mockClear();
      for (let i = 0; i < 1100; i++) {
        normalizeURL(`wss://lru-churn-${i}.example/a`);
        expect(normalizeURL(hot)).toBe("wss://xn--bcher-kva.lru-hot.example/a/b");
      }
      expect(constructor).not.toHaveBeenCalled();
      normalizeURL(cold);
      expect(constructor).toHaveBeenCalledOnce();
      for (const convert of [serializeURL, ensureWebSocketURL, ensureHttpURL, normalizeRelayUrl]) {
        const input = "https://bücher.lru-conversion.example/a//b";
        const expected = convert(input);
        constructor.mockClear();
        for (let i = 0; i < 10; i++) expect(convert(input)).toBe(expected);
        expect(constructor).not.toHaveBeenCalled();
      }
      // Mutable URL instances must never share cached output objects.
      const object = new NativeURL("wss://mutable.example/a//b");
      expect(normalizeURL(object).pathname).toBe("/a/b");
      object.pathname = "/c//d";
      expect(normalizeURL(object).pathname).toBe("/c/d");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns independent URL objects without mutating the input", () => {
    for (const input of ["wss://EXAMPLE.com:443/a//b?x=//#//", "custom://", "mailto:a//b@example.com"]) {
      const url = new URL(input);
      const before = url.href;
      const normalized = normalizeURL(url);
      expect(normalized).toBeInstanceOf(URL);
      expect(normalized).not.toBe(url);
      expect(normalized.href).toBe(String(nativeNormalize(url)));
      expect(url.href).toBe(before);
    }
  });

  it("normalizes ordinary strings without constructing native URL objects", () => {
    const NativeURL = globalThis.URL;
    const constructor = vi.fn(function (input: string | URL) {
      return new NativeURL(input);
    });
    vi.stubGlobal("URL", constructor);
    try {
      expect(normalizeURL("WSS://RELAY.example.com:00443/a//b?x=//#//")).toBe("wss://relay.example.com/a/b?x=//#//");
      expect(normalizeURL("ws://localhost:00080")).toBe("ws://localhost/");
      expect(normalizeURL("https://example.com:00000")).toBe("https://example.com:0/");
      expect(serializeURL("https://strings-only.example/a//b")).toBe("https://strings-only.example/a//b");
      expect(getURLFilename("https://strings-only.example/?filename=video%2Emp4")).toBe("video.mp4");
      expect(isImageURL("https://strings-only.example/image.jpg")).toBe(true);
      expect(isVideoURL("https://strings-only.example/video.mp4")).toBe(true);
      expect(ensureWebSocketURL("https://strings-only.example/a//b")).toBe("wss://strings-only.example/a//b");
      expect(ensureHttpURL("wss://strings-only.example/a//b")).toBe("https://strings-only.example/a//b");
      expect(constructor).not.toHaveBeenCalled();
      normalizeURL("wss://bücher.constructor-fallback.example/");
      expect(constructor).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
