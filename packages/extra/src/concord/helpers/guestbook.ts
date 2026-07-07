// CORD-02 §5 Guestbook — coalescing membership motion into a member list.
//
// Self-signed Joins/Leaves and authorised Kicks coalesce flat: one final state
// per npub, latest-by-millisecond wins (ties by lower rumor id). That fold,
// merged with observed authors (anyone seen publishing is present) and minus
// the Banlist, yields the Complete Memberlist.

import { KIND, PERM } from "../types.js";
import type { DecodedEvent } from "../types.js";
import type { RumorTemplate } from "../types.js";
import { hasPerm } from "./permissions.js";
import type { Standing } from "./permissions.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Snapshot chunk size: 400 present members per event (CORD-02 §5). */
export const SNAPSHOT_CHUNK = 400;

/**
 * Refounder-signed snapshot rumors seeding a new epoch's Guestbook: present
 * members only, chunked at {@link SNAPSHOT_CHUNK}, all chunks sharing one
 * snapshot id and one timestamp (CORD-02 §5). Mirrors armada guestbook.ts.
 */
export function buildSnapshotRumors(members: string[], snapshotIdHex: string, ms: number = Date.now()): RumorTemplate[] {
  const chunks: string[][] = [];
  for (let i = 0; i < members.length; i += SNAPSHOT_CHUNK) chunks.push(members.slice(i, i + SNAPSHOT_CHUNK));
  if (chunks.length === 0) chunks.push([]);
  const n = chunks.length;
  return chunks.map((chunk, i) => ({
    kind: KIND.SNAPSHOT,
    content: JSON.stringify(chunk),
    tags: [
      ["snap", snapshotIdHex, (i + 1).toString(), n.toString()],
      ["ms", String(ms % 1000)],
    ],
  }));
}

interface Coalesced {
  present: boolean;
  ms: number;
  rumorId: string;
}

/**
 * Fold the Guestbook into a member set.
 *
 * @param observed  author npub -> latest ms seen publishing anywhere in the community
 * @param resolveStanding  roster lookup used to authorise Kicks
 */
export function foldMembers(
  guestbook: DecodedEvent[],
  observed: Map<string, number>,
  banlist: Set<string>,
  resolveStanding: (member: string) => Standing,
  nowMs: number = Date.now(),
): Set<string> {
  const state = new Map<string, Coalesced>();

  const consider = (subject: string, present: boolean, d: DecodedEvent) => {
    // Drop entries dated more than an hour ahead of our clock (anti-squat).
    if (d.ms > nowMs + ONE_HOUR_MS) return;
    const prev = state.get(subject);
    const wins =
      !prev ||
      d.ms > prev.ms ||
      (d.ms === prev.ms && d.rumor.id < prev.rumorId);
    if (wins) state.set(subject, { present, ms: d.ms, rumorId: d.rumor.id });
  };

  for (const d of guestbook) {
    const r = d.rumor;
    if (r.kind === 3306) {
      const verb = r.content.trim();
      if (verb === "join") consider(d.author, true, d);
      else if (verb === "leave") consider(d.author, false, d);
    } else if (r.kind === 3309) {
      // Kick: honoured only if signer holds KICK and outranks the target.
      const target = r.tags.find((t) => t[0] === "p")?.[1];
      if (!target) continue;
      const actor = resolveStanding(d.author);
      const victim = resolveStanding(target);
      if (hasPerm(actor.permissions, PERM.KICK) && actor.position < victim.position) {
        consider(target, false, d);
      }
    } else if (r.kind === 3312) {
      // Snapshot: secondhand seed for present members at the snapshot's time.
      try {
        for (const pk of JSON.parse(r.content) as string[]) {
          const prev = state.get(pk);
          if (!prev || d.ms > prev.ms) state.set(pk, { present: true, ms: d.ms, rumorId: r.id });
        }
      } catch {
        /* skip malformed snapshot */
      }
    }
  }

  const members = new Set<string>();
  for (const [npub, c] of state) if (c.present) members.add(npub);

  // Observation counts forward only: an author re-enters on activity newer than
  // their latest departure.
  for (const [author, lastMs] of observed) {
    const c = state.get(author);
    if (!c || c.present || lastMs > c.ms) members.add(author);
  }

  for (const banned of banlist) members.delete(banned);
  return members;
}
