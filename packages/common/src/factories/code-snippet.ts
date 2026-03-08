import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { CODE_SNIPPET_KIND } from "../helpers/code-snippet.js";
import {
  addCodeSnippetDependency,
  addCodeSnippetLicense,
  removeCodeSnippetDependency,
  removeCodeSnippetLicense,
  setCodeSnippetContent,
  setCodeSnippetDependencies,
  setCodeSnippetDescription,
  setCodeSnippetExtension,
  setCodeSnippetLanguage,
  setCodeSnippetLicense,
  setCodeSnippetName,
  setCodeSnippetRepo,
  setCodeSnippetRuntime,
} from "../operations/code-snippet.js";

export type CodeSnippetTemplate = KnownEventTemplate<typeof CODE_SNIPPET_KIND>;

export type CodeSnippetOptions = MetaTagOptions & {
  /** Programming language (lowercase) */
  language?: string;
  /** Filename or snippet name */
  name?: string;
  /** File extension without the dot */
  extension?: string;
  /** Brief description of what the code does */
  description?: string;
  /** Runtime or environment specification */
  runtime?: string;
  /** SPDX license identifier(s) — repeatable for multi-licensing */
  license?: string | string[];
  /** Repository URL or NIP-34 address */
  repo?: string;
  /** Dependencies required to run the code */
  dependencies?: string[];
};

/** A factory class for building NIP-C0 code snippet events (kind 1337) */
export class CodeSnippetFactory extends EventFactory<typeof CODE_SNIPPET_KIND, CodeSnippetTemplate> {
  /**
   * Creates a new code snippet factory
   * @param code - The code content
   * @param options - Optional metadata (language, name, extension, description, runtime, licenses, repo, deps)
   * @returns A new code snippet factory
   */
  static create(code: string, options?: CodeSnippetOptions): CodeSnippetFactory {
    let factory = new CodeSnippetFactory((res) => res(blankEventTemplate(CODE_SNIPPET_KIND))).code(code);

    if (options?.language) factory = factory.language(options.language);
    if (options?.name) factory = factory.name(options.name);
    if (options?.extension) factory = factory.extension(options.extension);
    if (options?.description) factory = factory.description(options.description);
    if (options?.runtime) factory = factory.runtime(options.runtime);
    if (options?.license) factory = factory.license(options.license);
    if (options?.repo) factory = factory.repo(options.repo);
    if (options?.dependencies) factory = factory.dependencies(options.dependencies);
    if (options) factory = factory.meta(options);

    return factory;
  }

  /** Sets the code content */
  code(code: string) {
    return this.chain(setCodeSnippetContent(code));
  }

  /** Sets the programming language (`l` tag) */
  language(language: string) {
    return this.chain(setCodeSnippetLanguage(language));
  }

  /** Sets the snippet name, commonly a filename (`name` tag) */
  name(name: string) {
    return this.chain(setCodeSnippetName(name));
  }

  /** Sets the file extension without the dot (`extension` tag) */
  extension(ext: string) {
    return this.chain(setCodeSnippetExtension(ext));
  }

  /** Sets the description (`description` tag) */
  description(description: string) {
    return this.chain(setCodeSnippetDescription(description));
  }

  /** Sets the runtime or environment specification (`runtime` tag) */
  runtime(runtime: string) {
    return this.chain(setCodeSnippetRuntime(runtime));
  }

  /** Adds a license tag (repeatable for multi-licensing per NIP-C0) */
  license(license: string | string[]) {
    return this.chain(setCodeSnippetLicense(license));
  }

  /** Adds a license tag (repeatable for multi-licensing per NIP-C0) */
  addLicense(license: string) {
    return this.chain(addCodeSnippetLicense(license));
  }

  /** Removes a license tag */
  removeLicense(license: string) {
    return this.chain(removeCodeSnippetLicense(license));
  }

  /** Sets the repository reference (`repo` tag); optionally a relay hint for NIP-34 addresses */
  repo(repo: string, relayHint?: string) {
    return this.chain(setCodeSnippetRepo(repo, relayHint));
  }

  /** Adds a dependency (`dep` tag) */
  addDependency(dep: string) {
    return this.chain(addCodeSnippetDependency(dep));
  }

  /** Removes a dependency */
  removeDependency(dep: string) {
    return this.chain(removeCodeSnippetDependency(dep));
  }

  /** Sets all the dependency tags on a code snippet event   */
  dependencies(dependencies: string[]) {
    return this.chain(setCodeSnippetDependencies(dependencies));
  }

  /** Sets meta tags */
  meta(options: MetaTagOptions) {
    return this.chain(setMetaTags(options));
  }
}
