import { ProfileContent } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";

import { blueprint } from "../../../factory/src/event-factory.jsnt-factory.js";
import { setProfile } from "../../../factory/src/operations/profile.jsions/profile.js";

/** User Profile (kind 0) blueprint */
export function ProfileBlueprint(content: ProfileContent) {
  return blueprint(kinds.Metadata, setProfile(content));
}
