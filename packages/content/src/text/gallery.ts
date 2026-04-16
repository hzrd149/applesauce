import { Transformer } from "unified";
import { convertToUrl, getURLFilename, IMAGE_EXT } from "applesauce-core/helpers/url";

import { BlossomURI, Link, Root } from "../nast/types.js";

export interface GalleriesOptions {
  /** When true, adjacent `blossom:` image URIs are clustered alongside HTTP image links. Defaults to false. */
  includeBlossom?: boolean;
}

/** Group images into galleries in an ATS tree */
export function galleries(types = IMAGE_EXT, options: GalleriesOptions = {}): Transformer<Root> {
  const { includeBlossom = false } = options;

  return (tree) => {
    let items: (Link | BlossomURI)[] = [];

    const getItemHref = (item: Link | BlossomURI): string => (item.type === "link" ? item.href : item.raw);

    const commit = (index: number) => {
      // only create a gallery if there are more than a single image
      if (items.length > 1) {
        const start = tree.children.indexOf(items[0]);
        const end = tree.children.indexOf(items[items.length - 1]);

        // replace all nodes with a gallery
        tree.children.splice(start, 1 + end - start, { type: "gallery", links: items.map(getItemHref) });
        items = [];

        // return new cursor
        return end - 1;
      } else {
        items = [];
        return index;
      }
    };

    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i];

      try {
        if (node.type === "link") {
          const url = convertToUrl(node.href);
          const filename = getURLFilename(url);

          if (filename && types.some((ext) => filename.endsWith(ext))) {
            items.push(node);
          } else {
            i = commit(i);
          }
        } else if (node.type === "blossom" && includeBlossom) {
          if (types.some((ext) => ext === `.${node.ext.toLowerCase()}`)) {
            items.push(node);
          } else {
            i = commit(i);
          }
        } else if (node.type === "text" && items.length > 0) {
          const isEmpty = node.value === "\n" || !node.value.match(/[^\s]/g);

          if (!isEmpty) i = commit(i);
        }
      } catch (error) {
        i = commit(i);
      }
    }

    // Do one finally commit, just in case a link is the last element in the list
    commit(tree.children.length);
  };
}
