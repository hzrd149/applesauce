---
description: Share and read code snippets with language and runtime metadata
---

# Code Snippets

Code snippets are kind 1337 events whose content is the code itself, with tags for the language, filename, and runtime (NIP-C0). They are regular events, so editing a snippet means publishing a new one.

## Reading a snippet

Load a snippet by id with `store.event()`, which uses the store's [event loader](/loading/loaders/event-loader) when the snippet isn't loaded, then cast it with `CodeSnippet`.

```ts
const snippet = use$(() => store.event(pointer).pipe(castEventStream(CodeSnippet, store)), [pointer.id]);

snippet.event.content; // the code
snippet.language; // "typescript"
snippet.name; // "hello.ts"
snippet.extension; // "ts" when the tag is missing
snippet.license; // string[] of SPDX identifiers
snippet.dependencies; // string[]
```

`description`, `runtime`, and `repo` read the remaining tags. To list snippets, cast a `{ kinds: [1337] }` timeline with `castTimelineStream(CodeSnippet, store)`.

## Publishing a snippet

`CodeSnippetFactory.create()` takes the code and optional metadata, and each field also has a builder method.

```ts
const snippet = await CodeSnippetFactory.create(code, { language: "typescript", name: "hello.ts" })
  .runtime("node v20")
  .license("MIT")
  .addDependency("applesauce-core")
  .sign(signer);
```

`.license()` replaces every license tag while `.addLicense()` adds one. `.repo(url, relayHint)` links a git repository URL or NIP-34 repository address, and `.hashtags()` adds topics.

## Helpers

- `isValidCodeSnippet(event)` checks for kind 1337 with non-empty content, which the cast requires
- `getCodeSnippetLanguage`, `getCodeSnippetName`, `getCodeSnippetExtension`, `getCodeSnippetLicense`, and `getCodeSnippetDependencies` read the tags
- `CODE_SNIPPET_KIND` is the kind number

## Best Practices

- Set `language` in lowercase so clients can pick a syntax highlighter
- Prefer `extension` over guessing from `name` when choosing a file type
- Render the content as plain text in a code block, never as HTML
