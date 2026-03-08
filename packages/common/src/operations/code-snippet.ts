import { EventOperation } from "applesauce-core/factories";
import { setContent } from "applesauce-core/operations/content";
import { addNameValueTag, removeNameValueTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";

/** Sets the code snippet content */
export function setCodeSnippetContent(code: string): EventOperation {
  return setContent(code);
}

/** Sets the programming language tag (`l`) */
export function setCodeSnippetLanguage(language: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["l", language]));
}

/** Sets the name tag (commonly a filename) */
export function setCodeSnippetName(name: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["name", name]));
}

/** Sets the file extension tag (without the dot) */
export function setCodeSnippetExtension(extension: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["extension", extension]));
}

/** Sets the description tag */
export function setCodeSnippetDescription(description: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["description", description]));
}

/** Sets the runtime tag */
export function setCodeSnippetRuntime(runtime: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["runtime", runtime]));
}

/** Adds a license tag (can be repeated for multi-licensing per NIP-C0) */
export function addCodeSnippetLicense(license: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["license", license], false));
}

/** Removes a specific license tag by value */
export function removeCodeSnippetLicense(license: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["license", license]));
}

/** Sets the license tags on a code snippet event */
export function setCodeSnippetLicense(license: string | string[]): EventOperation {
  if (Array.isArray(license)) {
    return modifyPublicTags((tags) => [
      ...tags.filter((t) => t[0] !== "license"),
      ...license.map((l) => ["license", l]),
    ]);
  } else {
    return modifyPublicTags(setSingletonTag(["license", license]));
  }
}

/** Sets the repo tag (URL or NIP-34 address) */
export function setCodeSnippetRepo(repo: string, relayHint?: string): EventOperation {
  return modifyPublicTags(setSingletonTag(relayHint ? ["repo", repo, relayHint] : ["repo", repo]));
}

/** Adds a dependency tag (`dep`) */
export function addCodeSnippetDependency(dep: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["dep", dep], false));
}

/** Removes a dependency tag */
export function removeCodeSnippetDependency(dep: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["dep", dep]));
}

/** Sets all the dependency tags on a code snippet event */
export function setCodeSnippetDependencies(dependencies: string[]): EventOperation {
  return modifyPublicTags((tags) => [...tags.filter((t) => t[0] !== "dep"), ...dependencies.map((d) => ["dep", d])]);
}
