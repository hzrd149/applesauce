import { kinds } from "nostr-tools";
import { ProfilePointer } from "nostr-tools/nip19";

import { blueprint } from "../../../factory/src/event-factory.jsnt-factory.js";
import { setDescription, setImage, setTitle } from "../../../factory/src/operations/list.jsrations/list.js";
import { modifyHiddenTags, modifyPublicTags } from "../../../factory/src/operations/tags.jsry-operations/tags.js";
import { addPubkeyTag } from "../../../factory/src/operations/tag/common.jsrations/tag/common.js";
import { EventBlueprint } from "../../../factory/src/types.jscore/factory-types.js";

/** Creates a new kind 30000 follow set */
export function FollowSetBlueprint(
  list?: {
    title?: string;
    description?: string;
    image?: string;
  },
  users?:
    | {
        public?: ProfilePointer[];
        hidden?: ProfilePointer[];
      }
    | ProfilePointer[],
): EventBlueprint {
  const userOperations = users
    ? Array.isArray(users)
      ? [modifyPublicTags(...users.map((p) => addPubkeyTag(p)))]
      : [
          users?.public ? modifyPublicTags(...users.public.map((p) => addPubkeyTag(p))) : undefined,
          users?.hidden ? modifyHiddenTags(...users.hidden.map((p) => addPubkeyTag(p))) : undefined,
        ]
    : [];

  return blueprint(
    kinds.Followsets,

    // set list info tags
    list?.title ? setTitle(list.title) : undefined,
    list?.description ? setDescription(list.description) : undefined,
    list?.image ? setImage(list.image) : undefined,

    // add users to the list
    ...userOperations,
  );
}
