import { describe, expect, it } from "vitest";
import { isImageURL, isVideoURL, isStreamURL, isAudioURL, ensureWebSocketURL, ensureHttpURL } from "../url.js";

describe("isImageURL", () => {
  it("should return true for valid image URLs", () => {
    expect(isImageURL("https://example.com/image.png")).toBe(true);
    expect(isImageURL("https://example.com/image.jpg")).toBe(true);
    expect(isImageURL("https://example.com/image.jpeg")).toBe(true);
    expect(isImageURL("https://example.com/image.gif")).toBe(true);
    expect(isImageURL("https://example.com/image.svg")).toBe(true);
    expect(isImageURL("https://example.com/image.webp")).toBe(true);
    expect(isImageURL("https://example.com/image.avif")).toBe(true);
    expect(isImageURL(new URL("https://example.com/image.png"))).toBe(true);
  });

  it("should return false for non-image URLs", () => {
    expect(isImageURL("https://example.com/video.mp4")).toBe(false);
    expect(isImageURL("https://example.com/audio.mp3")).toBe(false);
    expect(isImageURL("https://example.com/document.pdf")).toBe(false);
    expect(isImageURL("https://example.com/page.html")).toBe(false);
  });

  it("should return false for invalid URLs without throwing", () => {
    expect(isImageURL("not a url")).toBe(false);
    expect(isImageURL("")).toBe(false);
    expect(isImageURL("://invalid")).toBe(false);
    expect(isImageURL("http://")).toBe(false);
    expect(isImageURL("http://[invalid")).toBe(false);
    expect(isImageURL("http://example.com:invalid")).toBe(false);
    expect(isImageURL("http://example.com:99999")).toBe(false);
  });
});

describe("isVideoURL", () => {
  it("should return true for valid video URLs", () => {
    expect(isVideoURL("https://example.com/video.mp4")).toBe(true);
    expect(isVideoURL("https://example.com/video.mkv")).toBe(true);
    expect(isVideoURL("https://example.com/video.webm")).toBe(true);
    expect(isVideoURL("https://example.com/video.mov")).toBe(true);
    expect(isVideoURL(new URL("https://example.com/video.mp4"))).toBe(true);
  });

  it("should return false for non-video URLs", () => {
    expect(isVideoURL("https://example.com/image.png")).toBe(false);
    expect(isVideoURL("https://example.com/audio.mp3")).toBe(false);
    expect(isVideoURL("https://example.com/document.pdf")).toBe(false);
  });

  it("should return false for invalid URLs without throwing", () => {
    expect(isVideoURL("not a url")).toBe(false);
    expect(isVideoURL("")).toBe(false);
    expect(isVideoURL("://invalid")).toBe(false);
    expect(isVideoURL("http://")).toBe(false);
    expect(isVideoURL("http://[invalid")).toBe(false);
    expect(isVideoURL("http://example.com:invalid")).toBe(false);
    expect(isVideoURL("http://example.com:99999")).toBe(false);
  });
});

describe("isStreamURL", () => {
  it("should return true for valid stream URLs", () => {
    expect(isStreamURL("https://example.com/stream.m3u8")).toBe(true);
    expect(isStreamURL(new URL("https://example.com/stream.m3u8"))).toBe(true);
  });

  it("should return false for non-stream URLs", () => {
    expect(isStreamURL("https://example.com/image.png")).toBe(false);
    expect(isStreamURL("https://example.com/video.mp4")).toBe(false);
    expect(isStreamURL("https://example.com/audio.mp3")).toBe(false);
  });

  it("should return false for invalid URLs without throwing", () => {
    expect(isStreamURL("not a url")).toBe(false);
    expect(isStreamURL("")).toBe(false);
    expect(isStreamURL("://invalid")).toBe(false);
    expect(isStreamURL("http://")).toBe(false);
    expect(isStreamURL("http://[invalid")).toBe(false);
    expect(isStreamURL("http://example.com:invalid")).toBe(false);
    expect(isStreamURL("http://example.com:99999")).toBe(false);
  });
});

describe("isAudioURL", () => {
  it("should return true for valid audio URLs", () => {
    expect(isAudioURL("https://example.com/audio.mp3")).toBe(true);
    expect(isAudioURL("https://example.com/audio.wav")).toBe(true);
    expect(isAudioURL("https://example.com/audio.ogg")).toBe(true);
    expect(isAudioURL("https://example.com/audio.aac")).toBe(true);
    expect(isAudioURL("https://example.com/audio.m4a")).toBe(true);
    expect(isAudioURL(new URL("https://example.com/audio.mp3"))).toBe(true);
  });

  it("should return false for non-audio URLs", () => {
    expect(isAudioURL("https://example.com/image.png")).toBe(false);
    expect(isAudioURL("https://example.com/video.mp4")).toBe(false);
    expect(isAudioURL("https://example.com/document.pdf")).toBe(false);
  });

  it("should return false for invalid URLs without throwing", () => {
    expect(isAudioURL("not a url")).toBe(false);
    expect(isAudioURL("")).toBe(false);
    expect(isAudioURL("://invalid")).toBe(false);
    expect(isAudioURL("http://")).toBe(false);
    expect(isAudioURL("http://[invalid")).toBe(false);
    expect(isAudioURL("http://example.com:invalid")).toBe(false);
    expect(isAudioURL("http://example.com:99999")).toBe(false);
  });
});

describe("ensureWebSocketURL", () => {
  it("should preserve ws: URLs and not convert them to wss:", () => {
    expect(ensureWebSocketURL("ws://example.com")).toBe("ws://example.com/");
    expect(ensureWebSocketURL("ws://example.com/path")).toBe("ws://example.com/path");
    expect(ensureWebSocketURL(new URL("ws://example.com"))).toEqual(new URL("ws://example.com"));
    expect(ensureWebSocketURL(new URL("ws://example.com/path"))).toEqual(new URL("ws://example.com/path"));
  });

  it("should preserve wss: URLs", () => {
    expect(ensureWebSocketURL("wss://example.com")).toBe("wss://example.com/");
    expect(ensureWebSocketURL("wss://example.com/path")).toBe("wss://example.com/path");
    expect(ensureWebSocketURL(new URL("wss://example.com"))).toEqual(new URL("wss://example.com"));
    expect(ensureWebSocketURL(new URL("wss://example.com/path"))).toEqual(new URL("wss://example.com/path"));
  });

  it("should convert http: URLs to ws:", () => {
    expect(ensureWebSocketURL("http://example.com")).toBe("ws://example.com/");
    expect(ensureWebSocketURL("http://example.com/path")).toBe("ws://example.com/path");
    expect(ensureWebSocketURL(new URL("http://example.com"))).toEqual(new URL("ws://example.com"));
    expect(ensureWebSocketURL(new URL("http://example.com/path"))).toEqual(new URL("ws://example.com/path"));
  });

  it("should convert https: URLs to wss:", () => {
    expect(ensureWebSocketURL("https://example.com")).toBe("wss://example.com/");
    expect(ensureWebSocketURL("https://example.com/path")).toBe("wss://example.com/path");
    expect(ensureWebSocketURL(new URL("https://example.com"))).toEqual(new URL("wss://example.com"));
    expect(ensureWebSocketURL(new URL("https://example.com/path"))).toEqual(new URL("wss://example.com/path"));
  });

  it("should convert domain-only URLs to wss: by default", () => {
    expect(ensureWebSocketURL("example.com")).toBe("wss://example.com/");
    expect(ensureWebSocketURL("example.com/path")).toBe("wss://example.com/path");
  });

  it("should preserve ports in URLs", () => {
    expect(ensureWebSocketURL("ws://example.com:8080")).toBe("ws://example.com:8080/");
    expect(ensureWebSocketURL("wss://example.com:8080")).toBe("wss://example.com:8080/");
    expect(ensureWebSocketURL("http://example.com:8080")).toBe("ws://example.com:8080/");
    expect(ensureWebSocketURL("https://example.com:8080")).toBe("wss://example.com:8080/");
  });

  it("should preserve query parameters and fragments", () => {
    expect(ensureWebSocketURL("ws://example.com/path?query=1#fragment")).toBe("ws://example.com/path?query=1#fragment");
    expect(ensureWebSocketURL("http://example.com/path?query=1#fragment")).toBe(
      "ws://example.com/path?query=1#fragment",
    );
    expect(ensureWebSocketURL("https://example.com/path?query=1#fragment")).toBe(
      "wss://example.com/path?query=1#fragment",
    );
  });

  it("should return the same type as input (string or URL)", () => {
    const stringInput = "ws://example.com";
    const urlInput = new URL("ws://example.com");

    expect(typeof ensureWebSocketURL(stringInput)).toBe("string");
    expect(ensureWebSocketURL(urlInput)).toBeInstanceOf(URL);
  });
});

describe("ensureHttpURL", () => {
  it("should convert ws: URLs to http:", () => {
    expect(ensureHttpURL("ws://example.com")).toBe("http://example.com/");
    expect(ensureHttpURL("ws://example.com/path")).toBe("http://example.com/path");
    expect(ensureHttpURL(new URL("ws://example.com"))).toEqual(new URL("http://example.com"));
    expect(ensureHttpURL(new URL("ws://example.com/path"))).toEqual(new URL("http://example.com/path"));
  });

  it("should convert wss: URLs to https:", () => {
    expect(ensureHttpURL("wss://example.com")).toBe("https://example.com/");
    expect(ensureHttpURL("wss://example.com/path")).toBe("https://example.com/path");
    expect(ensureHttpURL(new URL("wss://example.com"))).toEqual(new URL("https://example.com"));
    expect(ensureHttpURL(new URL("wss://example.com/path"))).toEqual(new URL("https://example.com/path"));
  });

  it("should preserve http: URLs", () => {
    expect(ensureHttpURL("http://example.com")).toBe("http://example.com/");
    expect(ensureHttpURL("http://example.com/path")).toBe("http://example.com/path");
    expect(ensureHttpURL(new URL("http://example.com"))).toEqual(new URL("http://example.com"));
    expect(ensureHttpURL(new URL("http://example.com/path"))).toEqual(new URL("http://example.com/path"));
  });

  it("should preserve https: URLs", () => {
    expect(ensureHttpURL("https://example.com")).toBe("https://example.com/");
    expect(ensureHttpURL("https://example.com/path")).toBe("https://example.com/path");
    expect(ensureHttpURL(new URL("https://example.com"))).toEqual(new URL("https://example.com"));
    expect(ensureHttpURL(new URL("https://example.com/path"))).toEqual(new URL("https://example.com/path"));
  });

  it("should convert domain-only URLs to http: by default", () => {
    expect(ensureHttpURL("example.com")).toBe("http://example.com/");
    expect(ensureHttpURL("example.com/path")).toBe("http://example.com/path");
  });

  it("should preserve ports in URLs", () => {
    expect(ensureHttpURL("ws://example.com:8080")).toBe("http://example.com:8080/");
    expect(ensureHttpURL("wss://example.com:8080")).toBe("https://example.com:8080/");
    expect(ensureHttpURL("http://example.com:8080")).toBe("http://example.com:8080/");
    expect(ensureHttpURL("https://example.com:8080")).toBe("https://example.com:8080/");
  });

  it("should preserve query parameters and fragments", () => {
    expect(ensureHttpURL("ws://example.com/path?query=1#fragment")).toBe("http://example.com/path?query=1#fragment");
    expect(ensureHttpURL("wss://example.com/path?query=1#fragment")).toBe("https://example.com/path?query=1#fragment");
    expect(ensureHttpURL("http://example.com/path?query=1#fragment")).toBe("http://example.com/path?query=1#fragment");
    expect(ensureHttpURL("https://example.com/path?query=1#fragment")).toBe(
      "https://example.com/path?query=1#fragment",
    );
  });

  it("should return the same type as input (string or URL)", () => {
    const stringInput = "http://example.com";
    const urlInput = new URL("http://example.com");

    expect(typeof ensureHttpURL(stringInput)).toBe("string");
    expect(ensureHttpURL(urlInput)).toBeInstanceOf(URL);
  });
});
