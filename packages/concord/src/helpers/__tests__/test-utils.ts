import type { DecodedEvent, RumorTemplate } from "../../types.js";

/** A synthetic decoded plane event for fold tests — no envelope required. */
export function decoded(
  rumor: RumorTemplate,
  author: string,
  ms = 1_000,
  id = Math.random().toString(16).slice(2),
): DecodedEvent {
  return {
    rumor: {
      id,
      kind: rumor.kind,
      pubkey: author,
      content: rumor.content,
      tags: rumor.tags,
      created_at: Math.floor(ms / 1000),
    },
    author,
    wrapId: id,
    sealKind: 20014,
    ms,
  };
}
