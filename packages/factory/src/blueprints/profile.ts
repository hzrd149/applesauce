import { ProfileContent } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";

import { blueprint } from "../event-factory.js";
import { setProfile } from "../operations/profile.js";

/** User Profile (kind 0) blueprint */
export function ProfileBlueprint(content: ProfileContent) {
  return blueprint(kinds.Metadata, setProfile(content));
}
