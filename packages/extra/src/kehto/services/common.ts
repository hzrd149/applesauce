import type { CommonServiceOptions } from "@kehto/services";
import { ActionRunner } from "applesauce-actions";
import { FollowUser, ReportEvent, ReportUser, UnfollowUser } from "applesauce-actions/actions";
import { castUser } from "applesauce-common/casts";
import { ReactionFactory } from "applesauce-common/factories";
import type { ReportReason } from "applesauce-common/helpers";
import { mergeRelaySets, normalizeToPubkey, type NostrEvent } from "applesauce-core/helpers";
import type { ISigner } from "applesauce-signers";
import { publishThroughStore } from "../foundation/pool.js";
import { getStoredInboxes, selectWriteRelays } from "../foundation/relays.js";
import { signForNapplet } from "../foundation/signer.js";
import type { KehtoState } from "../foundation/state.js";
import { errorMessage, settle } from "../helpers.js";
import { toNapProfile } from "./identity.js";
import { toRelayEventResult } from "./outbox.js";

/** Parses a hex pubkey, npub or nprofile into a hex pubkey */
function toPubkey(target: string) {
  const pubkey = normalizeToPubkey(target);
  if (!pubkey) throw new Error("invalid pubkey");
  return pubkey;
}

type ActionTools = {
  runner: ActionRunner;
  signer: ISigner;
  publish: (event: NostrEvent, relays?: string[]) => Promise<void>;
};

/** Creates {@link CommonServiceOptions} that run NAP-COMMON social actions through applesauce actions */
export function createCommonOptions(state: KehtoState): CommonServiceOptions {
  const { eventStore } = state.ctx;

  /** Runs an action with a signer that asks for approval, and reports the last event it published */
  async function act(windowId: string, action: (tools: ActionTools) => Promise<void>) {
    const current = state.getSigner();
    if (!current) return { ok: false, error: "no signer configured" };
    // Signer methods live on class prototypes, so wrap them explicitly instead of spreading
    const signer: ISigner = {
      getPublicKey: () => current.getPublicKey(),
      signEvent: (template) => signForNapplet(state, template, windowId),
      nip04: current.nip04,
      nip44: current.nip44,
    };

    let event: NostrEvent | undefined;
    const publish = async (signed: NostrEvent, relays?: string[]) => {
      event = signed;
      await publishThroughStore(state, relays?.length ? relays : selectWriteRelays(state), signed);
    };
    try {
      await action({ runner: new ActionRunner(eventStore, signer, publish), signer, publish });
      return { ok: true, event, eventId: event?.id };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  async function loadEvent(id: string) {
    const event = await settle(eventStore.event(id), undefined, state.timeout);
    if (!event) throw new Error("event not found");
    return event;
  }

  return {
    getProfile: async (target) => {
      try {
        const pubkey = toPubkey(target);
        const profile = await settle(castUser(pubkey, eventStore).profile$, undefined, state.timeout);
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
      const user = state.getUser();
      if (!user) return { ok: false, pubkeys: [], error: "no signer configured" };
      return { ok: true, pubkeys: (await settle(user.contacts$, [], state.timeout)).map((u) => u.pubkey) };
    },
    follow: (pubkeys, { windowId }) =>
      act(windowId, async ({ runner }) => {
        for (const pubkey of pubkeys) await runner.run(FollowUser, toPubkey(pubkey));
      }),
    unfollow: (pubkeys, { windowId }) =>
      act(windowId, async ({ runner }) => {
        for (const pubkey of pubkeys) await runner.run(UnfollowUser, toPubkey(pubkey));
      }),
    react: (id, reaction, href, { windowId }) =>
      act(windowId, async ({ signer, publish }) => {
        const target = await loadEvent(id);
        const emoji = href ? { shortcode: reaction.replace(/^:|:$/g, ""), url: href } : reaction;
        const event = await ReactionFactory.create(target, emoji).sign(signer);
        // Reactions go to our outboxes and the author's inboxes so they see it
        await publish(event, mergeRelaySets(selectWriteRelays(state), getStoredInboxes(state, target.pubkey)));
      }),
    report: (target, reason, text, { windowId }) =>
      act(windowId, async ({ runner }) => {
        if (target.type === "pubkey")
          return runner.run(ReportUser, toPubkey(target.pubkey), reason as ReportReason, text);
        const pubkey = target.pubkey ?? (await loadEvent(target.id)).pubkey;
        await runner.run(ReportEvent, { id: target.id, pubkey }, reason as ReportReason, text);
      }),
  };
}
