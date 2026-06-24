import { EventOperation } from "applesauce-core/factories";
import { eventPipe } from "applesauce-core/helpers";
import { addNameValueTag, removeSingletonTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";

function setNullableSingletonTag(name: string, value: string | number | null): EventOperation {
  return modifyPublicTags(value === null ? removeSingletonTag(name) : setSingletonTag([name, String(value)], true));
}

/** Sets or removes the issuer claim. */
export function setIssuer(value: string | null): EventOperation {
  return setNullableSingletonTag("iss", value);
}

/** Sets or removes the subject claim. */
export function setSubject(value: string | null): EventOperation {
  return setNullableSingletonTag("sub", value);
}

/** Sets or removes the issued-at claim. */
export function setIssuedAt(value: number | null): EventOperation {
  return setNullableSingletonTag("iat", value);
}

/** Sets or removes the expiration claim. */
export function setExpiration(value: number | null): EventOperation {
  return setNullableSingletonTag("exp", value);
}

/** Sets or removes the not-before claim. */
export function setNotBefore(value: number | null): EventOperation {
  return setNullableSingletonTag("nbf", value);
}

/** Adds an audience claim. */
export function addAudience(value: string, replace = true): EventOperation {
  return modifyPublicTags(addNameValueTag(["aud", value], replace));
}

/** Removes a matching audience claim. */
export function removeAudience(value: string): EventOperation {
  return modifyPublicTags((tags) => tags.filter((tag) => !(tag[0] === "aud" && tag[1] === value)));
}

/** Removes all audience claims. */
export function clearAudiences(): EventOperation {
  return modifyPublicTags((tags) => tags.filter((tag) => tag[0] !== "aud"));
}

/** Replaces all audience claims. */
export function setAudiences(values: string[]): EventOperation {
  return eventPipe(clearAudiences(), ...values.map((value) => addAudience(value, false)));
}

/** Sets or removes a singleton claim. */
export function setClaim(name: string, value: string | number | null): EventOperation {
  return setNullableSingletonTag(name, value);
}

/** Adds an application-defined claim. */
export function addClaim(name: string, value: string | number, replace = true): EventOperation {
  return modifyPublicTags(addNameValueTag([name, String(value)], replace));
}

/** Removes matching values for a claim, or all tags with the claim name when value is omitted. */
export function removeClaim(name: string, value?: string | number): EventOperation {
  return modifyPublicTags((tags) =>
    tags.filter((tag) => (value === undefined ? tag[0] !== name : !(tag[0] === name && tag[1] === String(value)))),
  );
}

/** Removes all tags with the claim name. */
export function clearClaim(name: string): EventOperation {
  return removeClaim(name);
}
