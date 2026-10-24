import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { Observable } from "rxjs";
import type { KehtoAccount } from "../foundation/account.js";
import type { KehtoSignRequest } from "../types.js";
import type { CommonServiceOptions } from "@kehto/services";
import { ActionRunner } from "applesauce-actions";
import { FollowUser, ReportEvent, ReportUser, UnfollowUser } from "applesauce-actions/actions";
import { castUser } from "applesauce-common/casts";
import { ReactionFactory } from "applesauce-common/factories";
import type { ReportReason } from "applesauce-common/helpers";
import { mergeRelaySets, normalizeToPubkey, type NostrEvent } from "applesauce-core/helpers";
import type { ISigner } from "applesauce-signers";
import { firstValueFrom } from "rxjs";
import { kehtoAccount$ } from "../foundation/account.js";
import { publishThroughStore } from "../foundation/pool.js";
import { getStoredInboxes, getStoredOutboxes } from "../foundation/relays.js";
import { createApprovingSigner } from "../foundation/signer.js";
import { configured$, errorMessage, settle } from "../helpers.js";
import { toNapProfile } from "./identity.js";
import { toRelayEventResult } from "./outbox.js";

/** Options for {@link createCommonOptions} */
export interface KehtoCommonOptions {
  /** The shared event store with host loaders configured */
  eventStore: EventStore;
  /** The relay pool used for napplet traffic */
  pool: RelayPool;
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The shared resolved account stream, overriding signer resolution when provided */
  account$?: Observable<KehtoAccount | undefined>;
  /** The wait for missing data in milliseconds (default 4000) */
  timeout?: number;
  /** The relays used when user relay lists are unavailable */
  fallbackRelays?: string[] | Observable<string[]>;
  /** The host callback approving a napplet signing request */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
}

/** Parses a hex pubkey, npub or nprofile into a hex pubkey */
function toPubkey(target: string) {
  const pubkey = normalizeToPubkey(target);
  if (!pubkey) throw new Error("invalid pubkey");
  return pubkey;
}

type ActionTools = {
  runner: ActionRunner;
  signer: ISigner;
  writeRelays: string[];
  publish: (event: NostrEvent, relays?: string[]) => Promise<void>;
};

/** Creates {@link CommonServiceOptions} that run NAP-COMMON social actions through applesauce actions */
export function createCommonOptions(config: KehtoCommonOptions): CommonServiceOptions {
  const { eventStore } = config;

  /** Runs an action with a signer that asks for approval, and reports the last event it published */
  async function runAction(windowId: string, action: (tools: ActionTools) => Promise<void>) {
    const account = await firstValueFrom(kehtoAccount$(config));
    if (!account) return { ok: false, error: "no signer configured" };

    const signer = createApprovingSigner(account.signer, { approve: config.approve, windowId })!;
    const outboxes = getStoredOutboxes(eventStore, account.pubkey);
    const writeRelays = outboxes.length
      ? outboxes
      : await firstValueFrom(configured$(config.fallbackRelays, []));
    let publishedEvent: NostrEvent | undefined;
    const publish = async (signed: NostrEvent, relays?: string[]) => {
      publishedEvent = signed;
      await publishThroughStore(config, relays?.length ? relays : writeRelays, signed);
    };
    try {
      const runner = new ActionRunner(eventStore, signer, publish);
      await action({ runner, signer, publish, writeRelays });
      return { ok: true, event: publishedEvent, eventId: publishedEvent?.id };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  async function loadEvent(id: string) {
    const event = await settle(eventStore.event(id), undefined, config.timeout ?? 4000);
    if (!event) throw new Error("event not found");
    return event;
  }

  return {
    getProfile: async (target) => {
      try {
        const pubkey = toPubkey(target);
        const profile = await settle(castUser(pubkey, eventStore).profile$, undefined, config.timeout ?? 4000);
        return {
          ok: true,
          pubkey,
          profile: profile ? toNapProfile(profile) : null,
          result: profile && toRelayEventResult(profile.event),
        };
      } catch (err) {
        return { ok: false, pubkey: "", error: errorMessage(err) };
      }
    },
    follows: async () => {
      const account = await firstValueFrom(kehtoAccount$(config));
      if (!account) return { ok: false, pubkeys: [], error: "no signer configured" };

      const user = castUser(account.pubkey, eventStore);
      const contacts = await settle(user.contacts$, [], config.timeout ?? 4000);
      return { ok: true, pubkeys: contacts.map((contact) => contact.pubkey) };
    },
    follow: (pubkeys, { windowId }) =>
      runAction(windowId, async ({ runner }) => {
        for (const pubkey of pubkeys) {
          await runner.run(FollowUser, toPubkey(pubkey));
        }
      }),
    unfollow: (pubkeys, { windowId }) =>
      runAction(windowId, async ({ runner }) => {
        for (const pubkey of pubkeys) {
          await runner.run(UnfollowUser, toPubkey(pubkey));
        }
      }),
    react: (id, reaction, href, { windowId }) =>
      runAction(windowId, async ({ signer, publish, writeRelays }) => {
        const target = await loadEvent(id);
        const emoji = href ? { shortcode: reaction.replace(/^:|:$/g, ""), url: href } : reaction;
        const event = await ReactionFactory.create(target, emoji).sign(signer);
        // Reactions go to our outboxes and the author's inboxes so they see it
        await publish(event, mergeRelaySets(writeRelays, getStoredInboxes(config.eventStore, target.pubkey)));
      }),
    report: (target, reason, text, { windowId }) =>
      runAction(windowId, async ({ runner }) => {
        if (target.type === "pubkey") {
          return runner.run(ReportUser, toPubkey(target.pubkey), reason as ReportReason, text);
        }

        const pubkey = target.pubkey ?? (await loadEvent(target.id)).pubkey;
        await runner.run(ReportEvent, { id: target.id, pubkey }, reason as ReportReason, text);
      }),
  };
}
