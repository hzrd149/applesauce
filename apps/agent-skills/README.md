# Agent Skills

Publishes the Applesauce SDK as an installable [agent skill](https://agentskills.io) at `https://applesauce.build/.well-known/agent-skills/`.

Agents can install it with the [`skills` CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add https://applesauce.build
```

## What gets built

`pnpm --filter applesauce-agent-skills build` emits:

```
dist/applesauce/
  SKILL.md              # router (hand-written)
  references/           # generated skill references for inspection
  assets/               # bundled source examples and resources

dist/.well-known/agent-skills/
  index.json            # v0.2.0 discovery index
  applesauce.tar.gz     # SKILL.md + companion reference files
```

The build then mirrors `dist/.well-known/` into `../docs/public/.well-known/` so that VitePress serves the endpoint when the docs site deploys.

## Skill contents

The archive follows the [skill-creator](https://github.com/anthropics/skills) layout: a single hand-written `SKILL.md` at the root that loads first, plus reference docs under `references/` that the agent reads on demand.

```
SKILL.md                          # router (hand-written)
references/
  overview.md                     # hand-written
  patterns.md                     # hand-written
  troubleshooting.md              # hand-written
  examples.md                     # generated index of example asset paths and descriptions
  packages/<name>.md              # generated from each package's README.md
assets/
  examples/<topic>/<id>.ts[x]     # raw examples copied from apps/examples/src/examples/
```

Sources:

- Hand-written content lives in `src/skill/SKILL.md` and `src/skill/references/*.md`.
- Generated content is produced by `src/build.mjs` at build time:
  - One `references/packages/<name>.md` per workspace package, copied verbatim from `packages/<name>/README.md`.
  - One `references/examples.md` index listing example asset paths and descriptions.
  - One raw `assets/examples/<id>.ts` or `.tsx` file per in-repo example, copied from the TypeScript source.

Edit the curated example allowlist at the top of `src/build.mjs`.

## Verifying

After `pnpm build`:

```bash
# Inspect the expanded skill directory
ls dist/applesauce
ls dist/applesauce/references

# Inspect the index
cat dist/.well-known/agent-skills/index.json

# Verify the digest matches
shasum -a 256 dist/.well-known/agent-skills/applesauce.tar.gz

# List archive contents
tar -tzf dist/.well-known/agent-skills/applesauce.tar.gz
```
