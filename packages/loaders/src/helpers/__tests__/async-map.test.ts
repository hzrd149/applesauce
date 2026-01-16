import { describe, it, expect } from "vitest";
import { loadAsyncMap } from "../async-map.js";

describe("loadAsyncMap", () => {
  const TIMEOUT = 10; // 10ms timeout for fast tests

  describe("basic functionality", () => {
    it("should resolve all promises successfully", async () => {
      const result = await loadAsyncMap(
        {
          a: Promise.resolve("value-a"),
          b: Promise.resolve(42),
          c: Promise.resolve(true),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        a: "value-a",
        b: 42,
        c: true,
      });
    });

    it("should handle an empty object", async () => {
      const result = await loadAsyncMap({}, TIMEOUT);
      expect(result).toEqual({});
    });

    it("should handle a single promise", async () => {
      const result = await loadAsyncMap(
        {
          single: Promise.resolve("single-value"),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        single: "single-value",
      });
    });

    it("should handle promises that resolve to undefined", async () => {
      const result = await loadAsyncMap(
        {
          a: Promise.resolve(undefined),
          b: Promise.resolve("value"),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        a: undefined,
        b: "value",
      });
    });

    it("should handle promises that resolve to null", async () => {
      const result = await loadAsyncMap(
        {
          a: Promise.resolve(null),
          b: Promise.resolve("value"),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        a: null,
        b: "value",
      });
    });
  });

  describe("timeout handling", () => {
    it("should return undefined for promises that timeout", async () => {
      const result = await loadAsyncMap(
        {
          fast: Promise.resolve("fast-value"),
          slow: new Promise((resolve) => setTimeout(() => resolve("slow-value"), TIMEOUT * 2)),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        fast: "fast-value",
        slow: undefined,
      });
    });

    it("should handle all promises timing out", async () => {
      const result = await loadAsyncMap(
        {
          a: new Promise((resolve) => setTimeout(() => resolve("a"), TIMEOUT * 2)),
          b: new Promise((resolve) => setTimeout(() => resolve("b"), TIMEOUT * 2)),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        a: undefined,
        b: undefined,
      });
    });

    it("should handle promises that resolve exactly at timeout boundary", async () => {
      // This test might be flaky, but it's good to have
      const result = await loadAsyncMap(
        {
          fast: Promise.resolve("fast"),
          boundary: new Promise((resolve) => setTimeout(() => resolve("boundary"), TIMEOUT)),
        },
        TIMEOUT,
      );

      // The boundary promise might resolve or timeout depending on timing
      expect(result.fast).toBe("fast");
      // Boundary could be either "boundary" or undefined
      expect(result.boundary === "boundary" || result.boundary === undefined).toBe(true);
    });
  });

  describe("rejection handling", () => {
    it("should return undefined for rejected promises", async () => {
      const result = await loadAsyncMap(
        {
          success: Promise.resolve("success"),
          failure: Promise.reject(new Error("test error")),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        success: "success",
        failure: undefined,
      });
    });

    it("should handle all promises rejecting", async () => {
      const result = await loadAsyncMap(
        {
          a: Promise.reject(new Error("error a")),
          b: Promise.reject(new Error("error b")),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        a: undefined,
        b: undefined,
      });
    });

    it("should handle promises that reject after timeout", async () => {
      const result = await loadAsyncMap(
        {
          fast: Promise.resolve("fast"),
          slowReject: new Promise((_, reject) => setTimeout(() => reject(new Error("slow reject")), TIMEOUT * 2)),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        fast: "fast",
        slowReject: undefined,
      });
    });
  });

  describe("mixed scenarios", () => {
    it("should handle mix of resolved, timeout, and rejected promises", async () => {
      const result = await loadAsyncMap(
        {
          resolved: Promise.resolve("resolved"),
          timeout: new Promise((resolve) => setTimeout(() => resolve("timeout"), TIMEOUT * 2)),
          rejected: Promise.reject(new Error("rejected")),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        resolved: "resolved",
        timeout: undefined,
        rejected: undefined,
      });
    });

    it("should handle complex nested objects in resolved values", async () => {
      const result = await loadAsyncMap(
        {
          simple: Promise.resolve("simple"),
          object: Promise.resolve({ nested: { value: 123 } }),
          array: Promise.resolve([1, 2, 3]),
        },
        TIMEOUT,
      );

      expect(result).toEqual({
        simple: "simple",
        object: { nested: { value: 123 } },
        array: [1, 2, 3],
      });
    });
  });

  describe("concurrent execution", () => {
    it("should execute all promises concurrently", async () => {
      const startTime = Date.now();
      const delays = [5, 5, 5]; // All should complete in ~5ms if concurrent

      const result = await loadAsyncMap(
        {
          a: new Promise((resolve) => setTimeout(() => resolve("a"), delays[0])),
          b: new Promise((resolve) => setTimeout(() => resolve("b"), delays[1])),
          c: new Promise((resolve) => setTimeout(() => resolve("c"), delays[2])),
        },
        TIMEOUT * 10, // Large timeout so we don't hit it
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // If concurrent, should take ~max(delays), not sum(delays)
      expect(duration).toBeLessThan(delays.reduce((a, b) => a + b, 0));
      expect(result).toEqual({
        a: "a",
        b: "b",
        c: "c",
      });
    });
  });

  describe("type safety", () => {
    it("should preserve types correctly", async () => {
      const result = await loadAsyncMap(
        {
          string: Promise.resolve("text"),
          number: Promise.resolve(42),
          boolean: Promise.resolve(true),
        },
        TIMEOUT,
      );

      // TypeScript should infer these types correctly
      const _string: string | undefined = result.string;
      const _number: number | undefined = result.number;
      const _boolean: boolean | undefined = result.boolean;

      expect(_string).toBe("text");
      expect(_number).toBe(42);
      expect(_boolean).toBe(true);
    });
  });
});
