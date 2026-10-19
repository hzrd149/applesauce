// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ComponentMap, useRenderedContent } from "../use-rendered-content.js";

it("reuses truncated renders and updates when content or maximum length changes", () => {
  const components: ComponentMap = { text: ({ node }) => <span>{node.value}</span> };
  const { result, rerender, unmount } = renderHook(
    ({ content, maxLength }) => useRenderedContent(content, components, { cacheKey: null, maxLength }),
    { initialProps: { content: "hello world", maxLength: 5 } },
  );
  const first = result.current;
  expect(renderToStaticMarkup(first!)).toBe("<span>hello</span>");
  rerender({ content: "hello world", maxLength: 5 });
  expect(result.current).toBe(first);
  rerender({ content: "hello world", maxLength: 3 });
  expect(renderToStaticMarkup(result.current!)).toBe("<span>hel</span>");
  rerender({ content: "other words", maxLength: 3 });
  expect(renderToStaticMarkup(result.current!)).toBe("<span>oth</span>");
  rerender({ content: "other words", maxLength: 0 });
  expect(renderToStaticMarkup(result.current!)).toBe("<span>other words</span>");
  unmount();
});
