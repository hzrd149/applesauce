import { NostrEvent } from "applesauce-core/helpers/event";
import {
  getCodeSnippetDependencies,
  getCodeSnippetDescription,
  getCodeSnippetExtension,
  getCodeSnippetLanguage,
  getCodeSnippetLicense,
  getCodeSnippetName,
  getCodeSnippetRepo,
  getCodeSnippetRuntime,
  isValidCodeSnippet,
  type CodeSnippetEvent,
} from "../helpers/code-snippet.js";
import { CastRefEventStore, EventCast } from "./cast.js";

export class CodeSnippet extends EventCast<CodeSnippetEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidCodeSnippet(event)) throw new Error("Invalid code snippet");
    super(event, store);
  }

  get language() {
    return getCodeSnippetLanguage(this.event);
  }
  get name() {
    return getCodeSnippetName(this.event);
  }

  get description() {
    return getCodeSnippetDescription(this.event);
  }

  get extension() {
    return getCodeSnippetExtension(this.event) || "ts";
  }
  get runtime() {
    return getCodeSnippetRuntime(this.event);
  }
  get license() {
    return getCodeSnippetLicense(this.event);
  }
  get repo() {
    return getCodeSnippetRepo(this.event);
  }
  get dependencies() {
    return getCodeSnippetDependencies(this.event);
  }
}
