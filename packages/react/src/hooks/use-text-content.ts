import { useMemo } from "react";
import { getParedTextContent } from "applesauce-content";
import { EventTemplate, NostrEvent } from "nostr-tools";

import { useRenderNast } from "./use-render-nast.js";
import { ComponentMap } from "../helpers/nast.js";

export { ComponentMap };

/** Returns the parsed and render text content for an event */
export function useRenderedContent(event: NostrEvent | EventTemplate, components: ComponentMap, content?: string) {
  const nast = useMemo(() => getParedTextContent(event, content), [event, content]);
  return useRenderNast(nast, components);
}
