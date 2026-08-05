---
id: SEED-009
status: dormant
planted: 2026-07-25
planted_during: v1.1-first-fixes / Phase 12.3
trigger_when: when relevant
scope: unknown
---

# SEED-009: First-class support for profile themes

## Captured Idea (verbatim)

> Add first class support for profile themes and build examples demonstrating thier use
> https://nostrhub.io/naddr1qvzqqqrcvypzqprpljlvcnpnw3pejvkkhrc3y6wvmd7vjuad0fg2ud3dky66gaxaqq88qun0ve5kcefdw35x2mt9wvvxzjzm

**Durable coordinate for the spec** (the nostrhub URL is a client-side shell and serves
no article text to fetchers — use this instead):

| | |
|---|---|
| kind | `30817` (the article/NIP-draft event itself) |
| `d` identifier | `profile-themes` |
| author pubkey | `0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd` |
| relay hints | none in the naddr |

## Why This Matters

_To be filled in. Run `/gsd-capture --seed --enrich SEED-009` to add context._

The spec was fetched and read at capture time, so this seed carries the actual contract
rather than a link. Two things worth knowing before scoping:

**1. It is three separate features, not one.** Two new kinds plus a kind-0 extension,
and the kind-0 half lands in a *different package* than the rest (see Package Mapping).
They can ship independently.

**2. It is a draft with no assigned NIP number**, self-described as "as seen in
[Ditto](https://ditto.pub/)". Kinds `36767` / `16767` are chosen, not allocated. That is
an argument for helper-level support that degrades gracefully rather than deep
integration, and for confirming the kinds are still current before building.

## When to Surface

**Trigger:** when relevant

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `/gsd-capture --seed --enrich SEED-009` to estimate effort.

This maps cleanly onto the repo's existing **"Adding Support For A New NIP"** checklist
in `CLAUDE.md` (helpers → casts → operations → factories → tests/snapshots →
`pnpm --filter applesauce-common test`), which is the best available effort anchor —
compare against a previously-landed NIP that followed it, e.g. NIP-58 badges
(`helpers/badge.ts`, `casts/`, `operations/`, `factories/`).

## The Spec (fetched 2026-07-25 from the event above)

### Kind 36767 — Theme Definition (addressable)

Shareable theme; one user may publish many, keyed by `d`. `content` MUST be `""`.

| Tag | Required | Notes |
|-----|----------|-------|
| `d` | Yes | theme slug, e.g. `"mk-dark-theme"` |
| `c` | Yes (×3) | color + role marker |
| `f` | No | font declaration |
| `bg` | No | background media |
| `title` | Yes | human-readable name |
| `alt` | Yes | NIP-31 fallback |

### Kind 16767 — Active Profile Theme (replaceable)

One per user; what visitors query to theme a profile view. `content` MUST be `""`.
Same tags as 36767 minus `d`, and `title` becomes optional.
Client behavior: query `{ kinds: [16767], authors: [pubkey], limit: 1 }`; setting a new
theme replaces; **removal is a kind-5 delete targeting kind 16767** (not an empty event).

### Shared tag grammar

**`c` — `["c", "#rrggbb", "<marker>"]`**
Lowercase 6-digit hex *including* `#`. Marker is one of `primary` / `text` /
`background`. **All three MUST be present, exactly one per marker** — this is a real
validation rule, not a convention.

**`f` — `["f", "<family>", "<url>", "<role>"]`**
Role is `body` or `title`; at most one per role. Notable ordering rule: **the `body`
tag MUST come before the `title` tag** so naive clients reading only the first `f` tag
get the body font. Legacy 3-element `f` tags (no role) are treated as `body`. Unknown
roles ignored; failed URL loads fall back gracefully.

**`bg` — `["bg", "url <url>", "mode <mode>", "m <mime>", ...]`**
`imeta`-style variadic space-delimited key/value entries. Required: `url`, `mode`
(`cover` | `tile`), `m` (MIME). Optional: `dim` (`WxH`), `blurhash`. At most one `bg`
per event. Unknown keys ignored for forward compat. Video backgrounds permitted but
clients MAY decline to render them.

### Kind 0 extension — `shape`

A `shape` field in the kind-0 JSON content holding **a single emoji** (multi-codepoint
allowed: flags, ZWJ sequences, skin-tone variants), used as an alpha mask over the
avatar. Absent → circle. Invalid → clients MUST fall back to circle. Purely cosmetic.

## Package Mapping (per `CLAUDE.md`'s new-NIP checklist)

**`packages/common`** — the two new kinds:
`helpers/` (guards `isValidProfileTheme`, tag parsers for `c`/`f`/`bg`, parse cache),
`casts/`, `operations/` (tag-level, via `modifyPublicTags`), `factories/`
(`create()`/`modify()`), plus tests and `helpers/__tests__/exports.test.ts` snapshot
updates.

**`packages/core`** — the kind-0 half. `ProfileContent` lives in
`packages/core/src/helpers/profile.ts` and would gain `shape?: string`. Everything
around it is already there: `getProfileContent`, `isValidProfile`, `getProfilePicture`,
`getDisplayName`, `ProfileModel` (`core/src/models/profile.ts`), `setProfile` /
`updateProfile` (`core/src/operations/profile.ts`), and the `Profile` cast in
`common/src/casts/profile.ts`. This is a small, self-contained change — and it is the
one that needs a changeset on `applesauce-core`.

**Possible reuse for the `bg` tag:** it is imeta-shaped, and imeta parsing already
exists at `packages/concord/src/helpers/imeta.ts`, with
`packages/common/src/operations/media-attachment.ts` (`addMediaAttachments`,
`FileMetadataFields`) on the common side. Check before writing a third parser.

**Greenfield confirmation:** no occurrence of `30817`, `36767` or `16767` anywhere in
the repo.

## Examples (the second half of the ask)

`apps/examples/src/examples/` has ~40 categories. Closest existing neighbours:
`simple/profile-editor.tsx`, `badges/profile.tsx`. A theme browser/editor pair fits
either under `simple/` or a new `themes/` category.

Two project conventions apply directly to this work and are easy to trip over:

- `CLAUDE.md`: "Never add drop shadows and avoid using cards, the UI looks better when
  its simple, clean and uses borders." Ironic but binding for a *theming* demo — the
  example chrome stays flat even while demonstrating user-supplied colors.
- `CLAUDE.md`: "THERE IS NO `.form-control` class" (DaisyUI). A theme editor is
  form-heavy, so this will come up.

## Open Questions (for enrichment, not decided here)

1. **How much validation belongs in helpers?** The spec has genuinely strict rules
   (exactly 3 `c` tags one per marker, ≤1 `f` per role, `body`-before-`title` ordering,
   ≤1 `bg`). Decide whether the guard rejects non-conforming events or parses
   leniently — profile theming is cosmetic, so hard rejection may be the wrong default.
2. **Is applying a theme in scope, or only reading/writing the events?** "First-class
   support" could stop at typed helpers/casts, or extend to a React helper that maps a
   theme onto CSS variables. The former is framework-agnostic and belongs in `common`;
   the latter belongs in `applesauce-react` and is a larger commitment.
3. **Untrusted URLs.** `f[2]` (font file) and `bg` `url` are attacker-supplied URLs
   rendered by consuming apps. Decide whether helpers bound/validate them or explicitly
   document that policy is the app's job.
4. **Confirm the draft is current** before building — no NIP number is assigned and the
   kinds are self-allocated.

## Notes

_Captured via one-shot seed capture. Spec content fetched from the nostr event at
capture time; the linked nostrhub page served no article text. Enrich with trigger,
why, and scope at your convenience._
