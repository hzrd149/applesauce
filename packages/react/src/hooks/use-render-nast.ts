import { useMemo } from "react";
import { Root } from "applesauce-content/nast";
import { ComponentMap, renderNast } from "../helpers/nast.js";

export { ComponentMap };

/** A hook to get the rendered output of a {@link Root} nostr syntax tree */
export function useRenderNast(root: Root | undefined, components: ComponentMap): JSX.Element | null {
  return useMemo(() => (root ? renderNast(root, components) : null), [root, Object.keys(components).join("|")]);
}
