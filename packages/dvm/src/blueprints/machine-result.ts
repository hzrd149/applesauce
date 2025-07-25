import { EventOperation } from "applesauce-factory";
import { blueprint } from "applesauce-factory/event-factory";
import { setContent } from "applesauce-factory/operations/content";
import { includeNameValueTag } from "applesauce-factory/operations/tags";
import { NostrEvent } from "nostr-tools";

// include copied "i" tags from request
function includeInputTags(request: NostrEvent): EventOperation {
  return (draft) => {
    const tags = Array.from(draft.tags);
    for (const tag of request.tags) {
      if (tag[0] === "i") tags.push(tag);
    }
    return { ...draft, tags };
  };
}

/** Build a translation result event */
export function MachineResultBlueprint(request: NostrEvent, payload: string) {
  return blueprint(
    request.kind + 1000,
    setContent(payload),
    includeInputTags(request),
    includeNameValueTag(["e", request.id]),
    includeNameValueTag(["p", request.pubkey]),
    includeNameValueTag(["request", JSON.stringify(request)]),
  );
}
