import { EventOperation } from "applesauce-core/factories";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { createExternalIdentityTag, ExternalIdentity } from "../helpers/external-identities.js";

function isIdentityTag(tag: string[], platform: string, identity: string) {
  return tag[0] === "i" && tag[1] === `${platform}:${identity}`;
}

/** Adds or replaces an external identity */
export function addExternalIdentity(identity: ExternalIdentity): EventOperation {
  return modifyPublicTags((tags) => [
    ...tags.filter((tag) => !isIdentityTag(tag, identity.platform, identity.identity)),
    createExternalIdentityTag(identity),
  ]);
}

/** Removes an external identity */
export function removeExternalIdentity(platform: string, identity: string): EventOperation {
  return modifyPublicTags((tags) => tags.filter((tag) => !isIdentityTag(tag, platform, identity)));
}

/** Replaces all external identities */
export function setExternalIdentities(identities: ExternalIdentity[]): EventOperation {
  return modifyPublicTags((tags) => [
    ...tags.filter((tag) => tag[0] !== "i"),
    ...identities.map(createExternalIdentityTag),
  ]);
}
