import { describe, expect, it } from "vitest";
import { isImageURL, isVideoURL, isStreamURL, isAudioURL } from "../url.js";

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
