// CORD-02 §5 Guestbook — coalescing membership motion into a member list.
//
// Self-signed Joins/Leaves and authorised Kicks coalesce flat: one final state
// per npub, latest-by-millisecond wins (ties by lower rumor id). That fold,
// merged with observed authors (anyone seen publishing is present) and minus
// the Banlist, yields the Complete Memberlist.

import { PERM } from "../types.js";
import type { DecodedEvent } from "../types.js";
import { hasPerm } from "./permissions.js";
import type { Standing } from "./permissions.js";
import { hasMalformedMs } from "./stream.js";

/** Concord self-signed join/leave kind (CORD-02 §5). */
export const JOIN_LEAVE_KIND = 3306;
/** Concord authorised kick kind (CORD-02 §5). */
export const KICK_KIND = 3309;
/** Concord memberlist snapshot kind (CORD-02 §5). */
export const SNAPSHOT_KIND = 3312;

/** Concord self-signed join verb (CORD-02 §5). */
export const JOIN_VERB = "join";
/** Concord self-signed leave verb (CORD-02 §5). */
export const LEAVE_VERB = "leave";
export type JoinLeaveVerb = typeof JOIN_VERB | typeof LEAVE_VERB;

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Snapshot chunk size: 400 present members per event (CORD-02 §5). */
export const SNAPSHOT_CHUNK = 400;

interface Coalesced {
  present: boolean;
  ms: number;
  rumorId: string;
  /** True when this state came from a secondhand snapshot (CORD-02 §5): any
   *  self-signed entry or authorized Kick at ≥ its time supersedes it. */
  snapshot: boolean;
}

/**
 * Fold the Guestbook into a member set.
 *
 * @param observed  author npub -> latest ms seen publishing anywhere in the community
 * @param resolveStanding  roster lookup used to authorise Kicks
 * @param refounder  the npub whose Refounding minted the current epoch; only its
 *   snapshots (kind 3312) are honored (CORD-02 §5). Omit to honor none.
 */
export function foldMembers(
  guestbook: DecodedEvent[],
  observed: Map<string, number>,
  banlist: Set<string>,
  resolveStanding: (member: string) => Standing,
  nowMs: number = Date.now(),
  refounder?: string,
): Set<string> {
  const state = new Map<string, Coalesced>();

  const consider = (subject: string, present: boolean, d: DecodedEvent) => {
    // Drop malformed entries (an ms tag outside 0..999) and ones dated more than
    // an hour ahead of our clock (anti-squat), rather than interpreting them.
    if (hasMalformedMs(d.rumor)) return;
    if (d.ms > nowMs + ONE_HOUR_MS) return;
    const prev = state.get(subject);
    // A firsthand entry (self-signed join/leave, or authorized kick) supersedes a
    // secondhand snapshot at equal time; two firsthand entries tie on lower rumor id.
    const wins = !prev || d.ms > prev.ms || (d.ms === prev.ms && (prev.snapshot || d.rumor.id < prev.rumorId));
    if (wins) state.set(subject, { present, ms: d.ms, rumorId: d.rumor.id, snapshot: false });
  };

  for (const d of guestbook) {
    const r = d.rumor;
    if (r.kind === JOIN_LEAVE_KIND) {
      const verb = r.content.trim();
      if (verb === JOIN_VERB) consider(d.author, true, d);
      else if (verb === LEAVE_VERB) consider(d.author, false, d);
    } else if (r.kind === KICK_KIND) {
      // Kick: honoured only if signer holds KICK and outranks the target.
      const target = r.tags.find((t) => t[0] === "p")?.[1];
      if (!target) continue;
      const actor = resolveStanding(d.author);
      const victim = resolveStanding(target);
      if (hasPerm(actor.permissions, PERM.KICK) && actor.position < victim.position) {
        consider(target, false, d);
      }
    } else if (r.kind === SNAPSHOT_KIND) {
      // Snapshot: secondhand seed, honored ONLY from the epoch's refounder and
      // only when well-formed, held to the same clock/ms guards as any entry.
      if (refounder === undefined || d.author !== refounder) continue;
      if (hasMalformedMs(r)) continue;
      if (d.ms > nowMs + ONE_HOUR_MS) continue;
      try {
        for (const pk of JSON.parse(r.content) as string[]) {
          const prev = state.get(pk);
          // Seeds present-state; any firsthand entry at ≥ its time overrides it.
          if (!prev || d.ms > prev.ms) state.set(pk, { present: true, ms: d.ms, rumorId: r.id, snapshot: true });
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
