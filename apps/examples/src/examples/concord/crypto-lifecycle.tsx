/**
 * Watch a Concord community's cryptographic state (ConcordKeys) evolve across its whole lifecycle — genesis, a private channel, an invite, a member join, a wrapped message, and two Refoundings that roll the root through epochs 0 → 1 → 2 — computed entirely with the functional crypto core, no ConcordClient.
 * @tags concord, encryption, crypto, epochs, rekey, nip-44
 * @related concord/community-list
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import {
  addChannelKey,
  buildRefounding,
  createCommunity,
  decodeWrap,
  decryptBundle,
  deriveConcordKeys,
  encryptBundle,
  newInviteToken,
  readRekey,
  verifyOwner,
  wrapForTarget,
  type ChannelMetadata,
  type ConcordKeys,
  type InviteBundle,
} from "applesauce-extra/concord";
import { PrivateKeySigner } from "applesauce-signers";
import { useEffect, useMemo, useState } from "react";

// ---- snapshot model --------------------------------------------------------

/** A flattened, render-friendly view of one actor's ConcordKeys at a step. */
type KeySnapshot = {
  present: boolean;
  epoch: number;
  root: string;
  control: string;
  guestbook: string;
  dissolved: string;
  nextRekey: string;
  channels: { name: string; pk: string; private: boolean }[];
  heldRoots: number;
  planes: number;
};

type Step = {
  title: string;
  detail: string;
  owner: KeySnapshot;
  member: KeySnapshot;
  /** A one-line note about what wire events this transition produced. */
  emitted?: string;
  /** Shown at the invite step: the key material the invite ciphertext carries. */
  invite?: { root: string; epoch: number; channels: number };
};

const REMOVED: KeySnapshot = {
  present: false,
  epoch: 0,
  root: "",
  control: "",
  guestbook: "",
  dissolved: "",
  nextRekey: "",
  channels: [],
  heldRoots: 0,
  planes: 0,
};

function snapshot(keys: ConcordKeys, channelMeta: ChannelMetadata[]): KeySnapshot {
  return {
    present: true,
    epoch: keys.material.root_epoch,
    root: keys.material.community_root,
    control: keys.control.pk,
    guestbook: keys.guestbook.pk,
    dissolved: keys.dissolved.pk,
    nextRekey: keys.nextBaseRekey.key.pk,
    channels: channelMeta.map((c) => ({
      name: c.name,
      pk: keys.channels.get(c.channel_id)?.pk ?? "—",
      private: !!c.private,
    })),
    heldRoots: keys.material.held_roots?.length ?? 0,
    planes: keys.planes.size,
  };
}

/** Decode the rekey wraps at the next-base-rekey address a member listens on. */
function decodeRekey(keys: ConcordKeys, wraps: NostrEvent[]) {
  return wraps
    .map((w) => {
      const info = keys.planes.get(w.pubkey);
      return info ? decodeWrap(w, info.convKey) : null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
}

// ---- the lifecycle ---------------------------------------------------------

/**
 * Drive one community from genesis through two Refoundings, capturing the key
 * state of the owner and one member at every step. Everything here is the real
 * functional crypto — no client, no relays.
 */
async function buildLifecycle(): Promise<Step[]> {
  const owner = new PrivateKeySigner(generateSecretKey());
  const ownerPub = await owner.getPublicKey();
  const member = new PrivateKeySigner(generateSecretKey());
  const memberPub = await member.getPublicKey();

  const steps: Step[] = [];

  // 0. Genesis — the owner founds the community (epoch 0, one public #general).
  const genesis = await createCommunity({ ownerPubkey: ownerPub, name: "Cryptographers", relays: ["wss://x"] });
  const generalId = genesis.generalChannelId;
  let channelMeta: ChannelMetadata[] = [{ channel_id: generalId, name: "general", private: false }];
  let ownerKeys = deriveConcordKeys(genesis.material, channelMeta);

  const genesisSnap = snapshot(ownerKeys, channelMeta);
  steps.push({
    title: "Genesis (epoch 0)",
    detail:
      "The owner mints a random community_root and derives every plane address from it via HKDF. The control, guestbook, and dissolved planes — plus the next epoch's rekey listen address — all fall out of the one root at epoch 0. No member exists yet.",
    owner: genesisSnap,
    member: REMOVED,
  });

  // 1. Add a private channel — mints its own key, appended to the material.
  const secretId = bytesToHex(generateSecretKey());
  ownerKeys = addChannelKey(ownerKeys, secretId, "secret");
  channelMeta = [...channelMeta, { channel_id: secretId, name: "secret", private: true, key: findKey(ownerKeys, secretId), epoch: 1 }];
  ownerKeys = deriveConcordKeys(ownerKeys.material, channelMeta, ownerKeys);
  steps.push({
    title: "Add a private #secret channel",
    detail:
      "A public channel's address derives from the community_root, so every member already has it. A private channel mints its OWN 32-byte key (addChannelKey) — its address derives from that key, not the root, so only key-holders can find or read it.",
    owner: snapshot(ownerKeys, channelMeta),
    member: REMOVED,
  });

  // 2. Create an invite — the ciphertext carries the root + private channel keys.
  const bundle: InviteBundle = { ...ownerKeys.material, creator_npub: ownerPub };
  const token = newInviteToken();
  const ciphertext = encryptBundle(bundle, token);
  steps.push({
    title: "Create an invite",
    detail:
      "An invite is the membership material (community_root, root_epoch, and every private channel key the inviter holds) encrypted under a one-time token. It is the only thing a new member needs — all addresses re-derive from it.",
    owner: snapshot(ownerKeys, channelMeta),
    member: REMOVED,
    invite: { root: bundle.community_root, epoch: bundle.root_epoch, channels: bundle.channels.length },
  });

  // 3. Member joins — decrypts the bundle and derives IDENTICAL addresses.
  const joined = decryptBundle(ciphertext, token);
  if (!verifyOwner(joined)) throw new Error("owner proof failed");
  let memberKeys = deriveConcordKeys(joined, channelMeta);
  steps.push({
    title: "Member joins",
    detail:
      "The member decrypts the invite, verifies the owner proof (community_id == sha256(owner ‖ salt)), and independently derives the keys. Because derivation is deterministic from the shared root, the member computes byte-identical control / guestbook / channel addresses — nothing is exchanged.",
    owner: snapshot(ownerKeys, channelMeta),
    member: snapshot(memberKeys, channelMeta),
    emitted: sameAddresses(ownerKeys, memberKeys)
      ? "Owner and member derived identical addresses on every plane."
      : "addresses diverged (unexpected)",
  });

  // 4. Wrap a message on #secret — owner seals it, member decodes it.
  const { wrap } = await wrapForTarget(
    ownerKeys,
    { plane: "channel", channelId: secretId },
    owner,
    { kind: 9, content: "gm 🔐", tags: [] },
  );
  const info = memberKeys.planes.get(wrap.pubkey)!;
  const decoded = decodeWrap(wrap, info.convKey);
  steps.push({
    title: "Wrap a message on #secret",
    detail:
      "wrapForTarget seals the rumor under the private channel's self-ECDH conversation key and gift-wraps it (kind 1059) at the channel address. The member opens it with the key it derived from the invite — no key was ever sent alongside the message.",
    owner: snapshot(ownerKeys, channelMeta),
    member: snapshot(memberKeys, channelMeta),
    emitted: `1 kind-1059 wrap at the #secret address → member decoded: "${decoded?.rumor.content ?? "??"}"`,
  });

  // 5. Refound → epoch 1 (rotate the root, keep the member).
  const plan1 = await buildRefounding(ownerKeys, owner, {
    recipients: [ownerPub, memberPub],
    self: ownerPub,
    heads: [],
    channels: channelMeta,
  });
  ownerKeys = plan1.next;
  // The private channel key is unchanged by a root roll, so its metadata carries over.
  channelMeta = channelMeta.map((c) =>
    c.private ? { ...c, key: findKey(ownerKeys, c.channel_id) } : c,
  );
  const outcome1 = await readRekey(
    memberKeys,
    decodeRekey(memberKeys, plan1.rekeyWraps),
    (r) => r === ownerPub,
    memberPub,
    member,
    channelMeta,
  );
  if (outcome1.kind === "adopt") memberKeys = outcome1.next;
  steps.push({
    title: "Refound → epoch 1 (keep the member)",
    detail:
      "A Refounding mints a NEW community_root at epoch 1 and delivers it to each kept member as a pairwise-encrypted rekey blob. Every root-derived address (control, guestbook, public channels, next-rekey) rolls to a new value; the prior root is retained in held_roots and its addresses stay in the planes map so old history still decodes. The member folds the blob and adopts the exact same new root.",
    owner: snapshot(ownerKeys, channelMeta),
    member: memberKeys.material.root_epoch === 1 ? snapshot(memberKeys, channelMeta) : REMOVED,
    emitted: `${plan1.rekeyWraps.length} rekey wrap(s) → member outcome: ${outcome1.kind}`,
  });

  // 6. Refound → epoch 2 (evict the member).
  const plan2 = await buildRefounding(ownerKeys, owner, {
    recipients: [ownerPub], // member excluded
    self: ownerPub,
    heads: [],
    channels: channelMeta,
  });
  const evictedKeysBefore = memberKeys;
  const outcome2 = await readRekey(
    memberKeys,
    decodeRekey(memberKeys, plan2.rekeyWraps),
    (r) => r === ownerPub,
    memberPub,
    member,
    channelMeta,
  );
  ownerKeys = plan2.next;
  channelMeta = channelMeta.map((c) =>
    c.private ? { ...c, key: findKey(ownerKeys, c.channel_id) } : c,
  );
  steps.push({
    title: "Refound → epoch 2 (evict the member)",
    detail:
      "This time the owner keeps only itself. The member sees a complete, authorized rotation that carries NO blob for them → readRekey returns 'removed'. The owner rolls to epoch 2 (held_roots now holds two prior roots); the member is frozen at epoch 1 and can no longer follow — every new address is derived from a root they will never receive.",
    owner: snapshot(ownerKeys, channelMeta),
    member: outcome2.kind === "removed" ? REMOVED : snapshot(evictedKeysBefore, channelMeta),
    emitted: `${plan2.rekeyWraps.length} rekey wrap(s) → member outcome: ${outcome2.kind}`,
  });

  return steps;
}

function findKey(keys: ConcordKeys, channelId: string): string {
  return keys.material.channels.find((c) => c.id === channelId)?.key ?? "";
}

function sameAddresses(a: ConcordKeys, b: ConcordKeys): boolean {
  return a.control.pk === b.control.pk && a.guestbook.pk === b.guestbook.pk;
}

// ---- rendering -------------------------------------------------------------

function shortHex(hex: string): string {
  if (!hex) return "—";
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

/** A single labelled address row, highlighted when it changed since last step. */
function Row({ label, value, changed, mono = true }: { label: string; value: string; changed?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-xs opacity-60">{label}</span>
      <code
        className={`text-xs break-all ${mono ? "font-mono" : ""} ${
          changed ? "text-warning font-semibold" : "opacity-80"
        }`}
      >
        {value}
      </code>
      {changed && <span className="badge badge-warning badge-xs">changed</span>}
    </div>
  );
}

function changedKeys(cur: KeySnapshot, prev?: KeySnapshot): Set<string> {
  const out = new Set<string>();
  if (!prev || !prev.present || !cur.present) return out;
  if (cur.root !== prev.root) out.add("root");
  if (cur.control !== prev.control) out.add("control");
  if (cur.guestbook !== prev.guestbook) out.add("guestbook");
  if (cur.dissolved !== prev.dissolved) out.add("dissolved");
  if (cur.nextRekey !== prev.nextRekey) out.add("nextRekey");
  if (cur.epoch !== prev.epoch) out.add("epoch");
  if (cur.heldRoots !== prev.heldRoots) out.add("heldRoots");
  if (cur.planes !== prev.planes) out.add("planes");
  return out;
}

function KeyCard({ title, snap, prev, tone }: { title: string; snap: KeySnapshot; prev?: KeySnapshot; tone: string }) {
  if (!snap.present) {
    return (
      <div className="border border-base-300 rounded-box p-4 flex flex-col gap-2 opacity-60">
        <div className="flex items-center gap-2">
          <h3 className="font-bold">{title}</h3>
          <span className="badge badge-ghost">no keys</span>
        </div>
        <p className="text-sm opacity-70">This actor holds no community keys at this step.</p>
      </div>
    );
  }
  const changed = changedKeys(snap, prev);
  return (
    <div className={`border rounded-box p-4 flex flex-col gap-2 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold flex-1">{title}</h3>
        <span className={`badge ${changed.has("epoch") ? "badge-warning" : "badge-outline"}`}>epoch {snap.epoch}</span>
        <span className={`badge ${changed.has("heldRoots") ? "badge-warning" : "badge-outline"}`}>
          {snap.heldRoots} held root{snap.heldRoots === 1 ? "" : "s"}
        </span>
        <span className={`badge ${changed.has("planes") ? "badge-warning" : "badge-outline"}`}>{snap.planes} planes</span>
      </div>
      <Row label="community_root" value={shortHex(snap.root)} changed={changed.has("root")} />
      <Row label="control" value={shortHex(snap.control)} changed={changed.has("control")} />
      <Row label="guestbook" value={shortHex(snap.guestbook)} changed={changed.has("guestbook")} />
      <Row label="dissolved" value={shortHex(snap.dissolved)} changed={changed.has("dissolved")} />
      <Row label="next rekey" value={shortHex(snap.nextRekey)} changed={changed.has("nextRekey")} />
      <div className="border-t border-base-300 mt-1 pt-2 flex flex-col gap-1">
        <span className="text-xs opacity-60">channels</span>
        {snap.channels.map((c) => (
          <div key={c.name} className="flex items-baseline gap-2">
            <span className="w-28 shrink-0 text-xs flex items-center gap-1">
              #{c.name}
              <span className={`badge badge-xs ${c.private ? "badge-secondary" : "badge-ghost"}`}>
                {c.private ? "private" : "public"}
              </span>
            </span>
            <code className="text-xs font-mono break-all opacity-80">{shortHex(c.pk)}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ConcordCryptoLifecycle() {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setSteps(null);
    setError(null);
    buildLifecycle()
      .then((s) => alive && setSteps(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const step = steps?.[i];
  const prev = i > 0 ? steps?.[i - 1] : undefined;
  const progress = useMemo(() => (steps ? ((i + 1) / steps.length) * 100 : 0), [i, steps]);

  return (
    <div className="w-full p-4 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Concord crypto lifecycle</h1>
        <p className="opacity-70">
          Every address a community uses derives from one secret — the <code>community_root</code> — at a given epoch.
          Step through a community's life and watch the <code>ConcordKeys</code> state change. All computed with the
          functional crypto core (no ConcordClient, no relays).
        </p>
      </div>

      {error && <div className="alert alert-error py-2">{error}</div>}
      {!steps && !error && <div className="opacity-70">Deriving keys…</div>}

      {steps && step && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>
              ‹ Prev
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setI((n) => Math.min(steps.length - 1, n + 1))}
              disabled={i === steps.length - 1}
            >
              Next ›
            </button>
            <span className="badge badge-outline">
              step {i + 1} / {steps.length}
            </span>
            <div className="flex-1" />
            <button className="btn btn-sm btn-ghost" onClick={() => (setI(0), setNonce((n) => n + 1))}>
              ↻ New run
            </button>
          </div>
          <progress className="progress progress-primary w-full" value={progress} max={100} />

          <div className="border border-base-300 rounded-box p-4 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 items-center">
              <h2 className="text-lg font-bold flex-1">{step.title}</h2>
              {step.emitted && <span className="badge badge-info badge-outline">{step.emitted}</span>}
            </div>
            <p className="text-sm opacity-80">{step.detail}</p>
            {step.invite && (
              <div className="border border-secondary/40 rounded-box p-3 mt-1 flex flex-wrap gap-2 text-sm">
                <span className="font-medium w-full">Invite ciphertext carries:</span>
                <span className="badge badge-secondary badge-outline font-mono">root {shortHex(step.invite.root)}</span>
                <span className="badge badge-secondary badge-outline">epoch {step.invite.epoch}</span>
                <span className="badge badge-secondary badge-outline">{step.invite.channels} channel key(s)</span>
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <KeyCard title="Owner" snap={step.owner} prev={prev?.owner} tone="border-primary/40" />
            <KeyCard title="Member" snap={step.member} prev={prev?.member} tone="border-base-300" />
          </div>

          <ol className="steps steps-vertical md:steps-horizontal w-full text-xs">
            {steps.map((s, idx) => (
              <li
                key={s.title}
                className={`step ${idx <= i ? "step-primary" : ""} cursor-pointer`}
                onClick={() => setI(idx)}
              >
                {s.title.replace(/\s*\(.*\)/, "")}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
