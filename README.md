# Applesauce

Applesauce is a collection typescript libraries to make building nostr web clients easier and is used in [noStrudel](https://github.com/hzrd149/nostrudel)

The full documentation can be found on the [documentation](https://hzrd149.github.io/applesauce) site.

## Installation

```bash
# using npm
npm install applesauce-core
# using pnpm
pnpm install applesauce-core
# using yarn
yarn add applesauce-core
```

## Development Setup

Clone the repository:

```bash
git clone https://github.com/hzrd149/applesauce.git
cd applesauce
```

Install dependencies:

```bash
pnpm install
```

Build the project:

```bash
pnpm build
```

## Publishing to JSR

All 13 libraries in `packages/` have generated `deno.json` manifests for the
`@applesauce` scope, such as `@applesauce/core` and `@applesauce/wallet-connect`.
JSR publishes TypeScript source; npm continues publishing the existing builds.

Use Deno 2.9.7 or later alongside the repository's pinned pnpm version:

```bash
pnpm jsr:sync     # Regenerate versions, exports, and dependency mappings
pnpm jsr:check    # Detect stale manifests without changing files
pnpm jsr:test     # Test manifest generation
pnpm jsr:smoke    # Check local JSR imports, shared stores, casts, and models
pnpm jsr:dry-run  # Validate all 13 packages without uploading
```

Commit generated manifests with their package changes. `pnpm npm:release-preview`,
`pnpm npm:release-commit`, and snapshot versioning synchronize them automatically.
Keep using the existing tests, builds, and npm release verification before a release.

From a clean, verified release commit, publish locally:

```bash
pnpm jsr:release
```

The command publishes the workspace in dependency order and opens browser
authentication for JSR. Your account needs publishing access to `@applesauce`;
create the package entries in that scope before the first release. npm publishing
remains a separate `pnpm npm:release` command. After a partial failure, inspect JSR's
package versions before retrying; published versions are immutable.

### JSR compatibility

- Internal imports resolve to `jsr:@applesauce/*`, not duplicate npm copies.
- `.js` source imports are resolved and rewritten with Deno's `--sloppy-imports`.
- Publishing uses `--allow-slow-types` because models and casts augment modules.
  Normal type checking remains enabled, but JSR's generated documentation may be
  incomplete and JSR does not generate Node.js declarations for these packages.
  Use the existing npm packages for typed Node.js consumption.
- The JSR React package uses React 19 because Deno's npm specifiers cannot express
  the npm package's React 18-or-19 union range. Import `use$` from
  `@applesauce/react/hooks`, or use the JSR subpath `/hooks/use-dollar`; JSR forbids
  `$` in export names.
- The obsolete wallet-connect `/types` export has no v7 source and is not exposed
  on JSR; its current types are available through the main entrypoint.
- SQLite adapters remain runtime-specific. Publishing `/bun` does not make it
  usable outside Bun, and native drivers still need their usual dependencies.

## Running tests

This repo uses [vitest](https://vitest.dev/) for all tests

```bash
# Run all tests
pnpm test
# Run coverage tests
pnpm coverage
# Run the tests in dev mode
pnpm vitest
```

## Running documentation

This repo is setup with [typedoc](https://typedoc.org/) for the typescript documentation and [vitepress](https://vitepress.dev/) for the documentation site

```bash
# Build the typedocs
pnpm typedoc
```

The `apps/docs` is the package for the docs site

```bash
cd apps/docs

# Run vitepress dev
pnpm dev

# Build vitepress
pnpm build
```

## React

The `applesauce-react` package contains various hooks and providers for using applesauce in react components, [Docs](https://applesauce.build/react/getting-started.html)

## AI Agents (MCP Server)

The `applesauce-mcp` tool provides semantic search over Applesauce documentation and code examples for AI agents through the Model Context Protocol. This helps AI assistants build Nostr applications with accurate API usage and real-world patterns.

**Quick Start:** Connect to the public server at `https://mcp.applesauce.build/mcp` in your AI-powered IDE (OpenCode, Cursor, Claude Desktop, etc.)

[Full Documentation](https://applesauce.build/introduction/agents.html) | [Source Code](https://github.com/hzrd149/applesauce-mcp)

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-new-feature`
3. Install dependencies: `pnpm install`
4. Make your changes
5. Run tests: `pnpm test`
6. Build the project: `pnpm build`
7. Format code: `pnpm format`
8. Commit your changes: `git commit -am 'Add some feature'`
9. Push to the branch: `git push origin feature/my-new-feature`
10. Submit a pull request
