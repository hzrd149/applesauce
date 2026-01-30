import { getTagValue, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { processTags } from "applesauce-core/helpers/tags";

// Code snippet kind (NIP-C0)
export const CODE_SNIPPET_KIND = 1337;

/** Type for validated code snippet events */
export type CodeSnippetEvent = KnownEvent<typeof CODE_SNIPPET_KIND>;

/** Returns the language tag value */
export function getCodeSnippetLanguage(snippet: CodeSnippetEvent): string;
export function getCodeSnippetLanguage(snippet: NostrEvent): string | undefined;
export function getCodeSnippetLanguage(snippet: NostrEvent): string | undefined {
  return getTagValue(snippet, "l");
}

/** Returns the name tag value */
export function getCodeSnippetName(snippet: CodeSnippetEvent): string;
export function getCodeSnippetName(snippet: NostrEvent): string | undefined;
export function getCodeSnippetName(snippet: NostrEvent): string | undefined {
  return getTagValue(snippet, "name");
}

/** Returns the description tag value */
export function getCodeSnippetDescription(snippet: NostrEvent): string | undefined {
  return getTagValue(snippet, "description");
}

/** Returns the extension tag value */
export function getCodeSnippetExtension(snippet: CodeSnippetEvent): string;
export function getCodeSnippetExtension(snippet: NostrEvent): string | undefined;
export function getCodeSnippetExtension(snippet: NostrEvent): string | undefined {
  return getTagValue(snippet, "extension");
}

/** Returns the runtime tag value */
export function getCodeSnippetRuntime(snippet: NostrEvent): string | undefined {
  return getTagValue(snippet, "runtime");
}

/** Returns all license tag values (can be repeated per NIP-C0 for multi-licensing) */
export function getCodeSnippetLicense(snippet: NostrEvent): string[] {
  return processTags(
    snippet.tags,
    (t) => (t[0] === "license" ? t : undefined),
    (t) => (t[1] ? t[1] : undefined),
  );
}

/** Returns the repository tag value (URL or NIP-34 Git repository reference) */
export function getCodeSnippetRepo(snippet: NostrEvent): string | undefined {
  return getTagValue(snippet, "repo");
}

/** Returns all "dep" tag values */
export function getCodeSnippetDependencies(snippet: NostrEvent): string[] {
  return processTags(
    snippet.tags,
    (t) => (t[0] === "dep" ? t : undefined),
    (t) => (t[1] ? t[1] : undefined),
  );
}

/** Validates that an event is a valid code snippet event */
export function isValidCodeSnippet(snippet: NostrEvent): snippet is CodeSnippetEvent {
  return snippet.kind === CODE_SNIPPET_KIND && snippet.content.length > 0;
}
