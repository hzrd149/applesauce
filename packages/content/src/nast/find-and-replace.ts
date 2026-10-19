import { BuildVisitor, visitParents } from "unist-util-visit-parents";
import { Content, Root, Text } from "./types.js";

type Replace = (...groups: string[]) => null | undefined | false | string | Content | Content[];
type FindAndReplaceTuple = [RegExp, Replace];
type FindAndReplaceList = FindAndReplaceTuple[];

/** Replaces matching text with content nodes while preserving unmatched text */
export function findAndReplace(tree: Root, list: FindAndReplaceList) {
  const pairs = list;
  let pairIndex = -1;

  const visitor: BuildVisitor<Root, "text"> = (node, parents) => {
    let index = -1;
    /** @type {Parents | undefined} */
    let grandparent;

    while (++index < parents.length) {
      const parent = parents[index];
      // const siblings = grandparent ? grandparent.children : undefined;

      grandparent = parent;
    }

    if (grandparent) {
      return handler(node, parents);
    }
    return undefined;
  };

  while (++pairIndex < pairs.length) {
    visitParents(tree, "text", visitor);
  }

  /**
   * Handle a text node which is not in an ignored parent.
   *
   * @param {Text} node
   *   Text node.
   * @param {Array<Parents>} parents
   *   Parents.
   * @returns {VisitorResult}
   *   Result.
   */
  function handler(node: Text, parents: Root[]) {
    const parent = parents[parents.length - 1];
    const find = pairs[pairIndex][0];
    const replace = pairs[pairIndex][1];
    let start = 0;
    let change = false;
    let nodes: Content[] = [];

    find.lastIndex = 0;

    let match = find.exec(node.value);

    while (match) {
      const position = match.index;
      /** @type {RegExpMatchObject} */
      // const matchObject = {
      //   index: match.index,
      //   input: match.input,
      //   stack: [...parents, node],
      // };
      // let value = replace(...match, matchObject);
      let value = replace(...match);

      if (typeof value === "string") {
        value = value.length > 0 ? { type: "text", value } : undefined;
      }

      // It wasn’t a match after all.
      if (value === false) {
        // False acts as if there was no match.
        // So we need to reset `lastIndex`, which currently being at the end of
        // the current match, to the beginning.
        find.lastIndex = position + 1;
      } else {
        if (start !== position) {
          nodes.push({
            type: "text",
            value: node.value.slice(start, position),
          });
        }

        if (Array.isArray(value)) {
          nodes.push(...value);
        } else if (value) {
          nodes.push(value);
        }

        start = position + match[0].length;
        change = true;
      }

      if (!find.global) {
        break;
      }

      match = find.exec(node.value);
    }

    if (change) {
      if (start < node.value.length) {
        nodes.push({ type: "text", value: node.value.slice(start) });
      }

      const index = parent.children.indexOf(node);
      parent.children.splice(index, 1, ...nodes);
      return index + nodes.length;
    }

    return undefined;
  }
}
