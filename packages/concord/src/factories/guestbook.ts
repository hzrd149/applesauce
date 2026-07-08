// CORD-02 §5 Guestbook rumor factories: joins/leaves, kicks, and refounder
// snapshots. Each builds an unsigned rumor template; sealing/wrapping is done by
// ../stream.js.

import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { JOIN_LEAVE_KIND, KICK_KIND, SNAPSHOT_KIND } from "../helpers/guestbook.js";
import { SNAPSHOT_CHUNK } from "../helpers/guestbook.js";
import { includeMs } from "../operations/channel.js";
import {
  includeInviteAttribution,
  includeKickTarget,
  includeSnapshotChunk,
  setJoinLeave,
} from "../operations/guestbook.js";

/** Options for building a join/leave rumor. */
export interface JoinLeaveOptions {
  /** Millisecond timestamp (defaults to now). */
  ms?: number;
  /** Invite attribution for a join (CORD-05). */
  invite?: { creator: string; label?: string };
}

/** A factory for kind 3306 join/leave rumors (CORD-02 §5). */
export class JoinLeaveFactory extends EventFactory<typeof JOIN_LEAVE_KIND> {
  static create(verb: "join" | "leave", opts?: JoinLeaveOptions): JoinLeaveFactory {
    let factory = new JoinLeaveFactory((res) => res(blankEventTemplate(JOIN_LEAVE_KIND)));
    factory = factory.verb(verb).ms(opts?.ms);
    if (opts?.invite) factory = factory.invite(opts.invite.creator, opts.invite.label);
    return factory;
  }

  /** Sets the join/leave verb as this rumor's content (CORD-02 §5) */
  verb(verb: "join" | "leave") {
    return this.chain(setJoinLeave(verb));
  }

  /** Adds the millisecond-resolution ordering remainder (CORD-02 §4) */
  ms(ms?: number) {
    return this.chain(includeMs(ms));
  }

  /** Attributes a join to the invite link that produced it (CORD-05) */
  invite(creator: string, label?: string) {
    return this.chain(includeInviteAttribution(creator, label));
  }
}

/** A factory for kind 3309 kick rumors (CORD-02 §5). */
export class KickFactory extends EventFactory<typeof KICK_KIND> {
  static create(member: string, vac?: [string, string, string], ms?: number): KickFactory {
    return new KickFactory((res) => res(blankEventTemplate(KICK_KIND))).ms(ms).target(member, vac);
  }

  /** Adds the millisecond-resolution ordering remainder (CORD-02 §4) */
  ms(ms?: number) {
    return this.chain(includeMs(ms));
  }

  /** Points this kick at its target, optionally carrying the actor's `vac` proof */
  target(member: string, vac?: [string, string, string]) {
    return this.chain(includeKickTarget(member, vac));
  }
}

/** A factory for a single chunk of a kind 3312 refounder snapshot (CORD-02 §5). */
export class SnapshotFactory extends EventFactory<typeof SNAPSHOT_KIND> {
  static create(
    members: string[],
    snapshotIdHex: string,
    index: number,
    count: number,
    ms: number = Date.now(),
  ): SnapshotFactory {
    return new SnapshotFactory((res) => res(blankEventTemplate(SNAPSHOT_KIND))).chunk(
      members,
      snapshotIdHex,
      index,
      count,
      ms,
    );
  }

  /** Fills one chunk of the snapshot: present members + the `snap` tag */
  chunk(members: string[], snapshotIdHex: string, index: number, count: number, ms?: number) {
    return this.chain(includeSnapshotChunk(members, snapshotIdHex, index, count, ms));
  }
}

/**
 * Refounder-signed snapshot factories seeding a new epoch's Guestbook: present
 * members only, chunked at {@link SNAPSHOT_CHUNK}, all chunks sharing one
 * snapshot id and one timestamp (CORD-02 §5).
 */
export function buildSnapshotFactories(
  members: string[],
  snapshotIdHex: string,
  ms: number = Date.now(),
): SnapshotFactory[] {
  const chunks: string[][] = [];
  for (let i = 0; i < members.length; i += SNAPSHOT_CHUNK) chunks.push(members.slice(i, i + SNAPSHOT_CHUNK));
  if (chunks.length === 0) chunks.push([]);
  const n = chunks.length;
  return chunks.map((chunk, i) => SnapshotFactory.create(chunk, snapshotIdHex, i + 1, n, ms));
}
