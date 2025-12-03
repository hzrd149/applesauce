import { truncateContent } from "applesauce-content/nast";
import { getParsedContent } from "applesauce-content/text";
import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { useMemo } from "react";
import { buildLinkRenderer, LinkRenderer } from "../helpers/build-link-renderer.js";
import { ComponentMap } from "../helpers/nast.js";
import { useRenderNast } from "./use-render-nast.js";

export { ComponentMap };

type Options = {
  /** The key to cache the results under, passing null will disable */
  cacheKey: symbol | null;
  /** Override transformers */
  transformers?: Parameters<typeof getParsedContent>[2];
  /** If set will use {@link buildLinkRenderer} to render links */
  linkRenderers?: LinkRenderer[];
  /** Override event content */
  content?: string;
  /** Maximum length */
  maxLength?: number;
};

/** Returns the parsed and render text content for an event */
export function useRenderedContent(
  event: NostrEvent | EventTemplate | string | undefined,
  components: ComponentMap,
  opts?: Options,
) {
  // if link renderers are set, override the link components
  const _components = useMemo(
    () => (opts?.linkRenderers ? { ...components, link: buildLinkRenderer(opts.linkRenderers) } : components),
    [opts?.linkRenderers, components],
  );

  // add additional transformers
  const nast = useMemo(
    () => (event ? getParsedContent(event, opts?.content, opts?.transformers, opts?.cacheKey) : undefined),
    [event, opts?.content, opts?.transformers, opts?.cacheKey],
  );

  let truncated = nast;
  if (opts?.maxLength && nast) truncated = truncateContent(nast, opts.maxLength);

  return useRenderNast(truncated, _components);
}
