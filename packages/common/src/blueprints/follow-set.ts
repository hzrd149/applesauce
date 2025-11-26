import { blueprint, EventBlueprint } from "applesauce-core/event-factory";
import { kinds } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { addProfilePointerTag } from "applesauce-core/operations/tag/common";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations/tags";
import { setDescription, setImage, setTitle } from "../operations/list.js";

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
      ? [modifyPublicTags(...users.map((p) => addProfilePointerTag(p)))]
      : [
          users?.public ? modifyPublicTags(...users.public.map((p) => addProfilePointerTag(p))) : undefined,
          users?.hidden ? modifyHiddenTags(...users.hidden.map((p) => addProfilePointerTag(p))) : undefined,
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
