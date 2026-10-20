/**
 * Generate gift-wrapped events (NIP-59) with encryption for private sharing
 * @tags gift-wrap, generator, encryption, nip-59
 * @related gift-wrap/dashboard, gift-wrap/timeline
 */
import { castUser } from "applesauce-common/casts";

import { randomBytes } from "@noble/hashes/utils.js";
import { EventStore } from "applesauce-core";
import { normalizeToPubkey } from "applesauce-core/helpers";
import { nip44 } from "applesauce-core/helpers/encryption";
import { finalizeEvent, getEventHash, kinds, NostrEvent, UnsignedEvent } from "applesauce-core/helpers/event";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { unixNow } from "applesauce-core/helpers/time";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { useMemo, useState } from "react";
import {
  switchMap,
  Subject,
  defer,
  range,
  timer,
  concatMap,
  exhaustMap,
  materialize,
  scan,
  map,
  tap,
  concatWith,
  of,
  catchError,
  startWith,
} from "rxjs";
import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const totalRandomUsers = [
  "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
  "npub18ams6ewn5aj2n3wt2qawzglx9mr4nzksxhvrdc4gzrecw7n5tvjqctp424",
  "npub1uac67zc9er54ln0kl6e4qp2y6ta3enfcg7ywnayshvlw9r5w6ehsqq99rx",
  "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z",
  "npub1qny3tkh0acurzla8x3zy4nhrjz5zd8l9sy9jys09umwng00manysew95gx",
  "npub1ye5ptcxfyyxl5vjvdjar2ua3f0hynkjzpx552mu5snj3qmx5pzjscpknpr",
  "npub1zuuajd7u3sx8xu92yav9jwxpr839cs0kc3q6t56vd5u9q033xmhsk6c2uc",
].map(normalizeToPubkey);

const pool = new RelayPool();
const eventStore = new EventStore({ verifyEvent });
const signer = new PrivateKeySigner();

// Create an address loader to load user profiles and replaceable events
// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  // Fallback to lookup relays if events can't be found
  lookupRelays: lookupRelays$,
});

/** Types of broken gift wraps */
export enum BrokenGiftWrapType {
  BrokenGiftWrap = "broken-gift-wrap",
  BrokenSealInGiftWrap = "broken-seal-in-gift-wrap",
  RandomSealKindInGiftWrap = "random-seal-kind-in-gift-wrap",
  BrokenRumorInSealInGiftWrap = "broken-rumor-in-seal-in-gift-wrap",
  RandomRumorKind = "random-rumor-kind",
  NIP17DMWithRandomBase64 = "nip17-dm-with-random-base64",
}

/** Generates random base64 encoded data of random length */
function generateRandomBase64Data(): string {
  // Random length between 10 and 1000 bytes
  const length = Math.floor(Math.random() * 9990) + 10;
  const randomData = randomBytes(length);

  // Convert Uint8Array to base64 using browser's btoa
  // Convert bytes to binary string first
  let binary = "";
  for (let i = 0; i < randomData.length; i++) {
    binary += String.fromCharCode(randomData[i]);
  }
  return btoa(binary);
}

type EventStatus = {
  event: NostrEvent;
  relayStatuses: Map<string, { ok: boolean; message?: string }>;
  index: number;
};

type DelayConfigProps = {
  minDelay: number;
  maxDelay: number;
  onMinDelayChange: (value: number) => void;
  onMaxDelayChange: (value: number) => void;
};

function DelayConfigInput({ minDelay, maxDelay, onMinDelayChange, onMaxDelayChange }: DelayConfigProps) {
  return (
    <div className="grid grid-cols-2 gap-4 mb-4">
      <div className="flex flex-col gap-2 w-full">
        <label className="label">
          <span className="label-text">Min Delay (ms)</span>
        </label>
        <input
          type="number"
          min="0"
          max="10000"
          className="input input-bordered w-full"
          value={minDelay}
          onChange={(e) => onMinDelayChange(Math.max(0, parseInt(e.target.value) || 0))}
        />
        <label className="label">
          <span className="label-text-alt">Minimum delay between events</span>
        </label>
      </div>
      <div className="flex flex-col gap-2 w-full">
        <label className="label">
          <span className="label-text">Max Delay (ms)</span>
        </label>
        <input
          type="number"
          min="0"
          max="10000"
          className="input input-bordered w-full"
          value={maxDelay}
          onChange={(e) => onMaxDelayChange(Math.max(0, parseInt(e.target.value) || 0))}
        />
        <label className="label">
          <span className="label-text-alt">Maximum delay between events</span>
        </label>
      </div>
    </div>
  );
}

type RelayStatusItemProps = {
  relay: string;
  status: { ok: boolean; message?: string };
};

function RelayStatusItem({ relay, status }: RelayStatusItemProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`text-sm font-mono ${
          status.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
        }`}
      >
        {status.ok ? "✓" : "✗"}
      </span>
      <span className="text-sm text-base-content/70 truncate flex-1">{relay}</span>
      {status.message && <span className="text-sm text-base-content/50">{status.message}</span>}
    </div>
  );
}

type RelayStatusListProps = {
  relayStatuses: Map<string, { ok: boolean; message?: string }>;
};

function RelayStatusList({ relayStatuses }: RelayStatusListProps) {
  return (
    <div className="mt-2 space-y-1">
      <div className="text-sm font-semibold text-base-content/70 mb-1">Relay Status:</div>
      {Array.from(relayStatuses.entries()).map(([relay, status]) => (
        <RelayStatusItem key={relay} relay={relay} status={status} />
      ))}
    </div>
  );
}

type EventStatusCardProps = {
  status: EventStatus;
  isPublishing: boolean;
};

function EventStatusCard({ status, isPublishing }: EventStatusCardProps) {
  return (
    <div className="bg-base-200 p-3 rounded">
      <div className="flex justify-between items-start mb-2">
        <span className="text-sm font-mono text-base-content/70">
          Event #{status.index + 1}
          {isPublishing && <span className="ml-2 text-primary">(Publishing...)</span>}
        </span>
        <span className="text-sm text-base-content/50">{status.event.id.slice(0, 16)}...</span>
      </div>
      <div className="text-sm font-mono break-all mb-2">
        <div className="mb-1">
          <span className="text-base-content/70">Content length: </span>
          <span className="text-base-content">{status.event.content.length} chars</span>
        </div>
        <div className="text-base-content/50 break-all">{status.event.content.slice(0, 100)}...</div>
      </div>
      <RelayStatusList relayStatuses={status.relayStatuses} />
    </div>
  );
}

type EventStatusListProps = {
  eventStatuses: EventStatus[];
  currentEventIndex: number | null;
  totalCount: number;
};

function EventStatusList({ eventStatuses, currentEventIndex, totalCount }: EventStatusListProps) {
  if (eventStatuses.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-2">
        Publish Attempts ({eventStatuses.length}/{totalCount})
      </h3>
      <div className="flex flex-col-reverse gap-2 max-h-lg overflow-y-auto">
        {eventStatuses.map((status) => (
          <EventStatusCard key={status.event.id} status={status} isPublishing={currentEventIndex === status.index} />
        ))}
      </div>
    </div>
  );
}

type InboxRelayInfoProps = {
  pubkey: string | null;
  inboxCount: number | null;
  inboxes: string[] | null;
};

function InboxRelayInfo({ pubkey, inboxCount, inboxes }: InboxRelayInfoProps) {
  if (!pubkey || pubkey.length !== 64) return null;

  return (
    <div className="alert mb-4">
      <span>
        {inboxes && inboxCount
          ? `Found ${inboxCount} inbox relay(s): ${inboxes.join(", ")}`
          : inboxes
            ? "No inbox relays published"
            : "Loading inbox relays..."}
      </span>
    </div>
  );
}

type GenerateButtonProps = {
  generating: boolean;
  currentEventIndex: number | null;
  totalCount: number;
  disabled: boolean;
  onClick: () => void;
};

function GenerateButton({ generating, currentEventIndex, totalCount, disabled, onClick }: GenerateButtonProps) {
  const buttonText = generating
    ? currentEventIndex !== null
      ? `Publishing event ${currentEventIndex + 1}/${totalCount}...`
      : "Generating..."
    : `Generate ${totalCount} Broken Event${totalCount !== 1 ? "s" : ""}`;

  return (
    <div className="flex gap-2 justify-end">
      <button className="btn btn-primary" onClick={onClick} disabled={disabled}>
        {buttonText}
      </button>
    </div>
  );
}

type BrokenTypeSelectorProps = {
  selectedType: BrokenGiftWrapType;
  onTypeChange: (type: BrokenGiftWrapType) => void;
};

function BrokenTypeSelector({ selectedType, onTypeChange }: BrokenTypeSelectorProps) {
  const types = [
    {
      value: BrokenGiftWrapType.BrokenGiftWrap,
      label: "Broken Gift Wrap",
      description: "Random base64 content in gift wrap - tests gift wrap decryption failure",
    },
    {
      value: BrokenGiftWrapType.BrokenSealInGiftWrap,
      label: "Broken Seal in Gift Wrap",
      description: "Valid gift wrap encryption, but encrypted content is random base64 instead of valid seal JSON",
    },
    {
      value: BrokenGiftWrapType.RandomSealKindInGiftWrap,
      label: "Random Seal Kind in Gift Wrap",
      description: "Valid gift wrap with seal that has wrong kind (not 13) - tests seal validation",
    },
    {
      value: BrokenGiftWrapType.BrokenRumorInSealInGiftWrap,
      label: "Broken Rumor in Seal in Gift Wrap",
      description: "Valid gift wrap and seal, but rumor content is random base64 instead of valid JSON",
    },
    {
      value: BrokenGiftWrapType.RandomRumorKind,
      label: "Random Rumor Kind",
      description: "Valid gift wrap and seal, but rumor has wrong kind (not 14) - tests rumor validation",
    },
    {
      value: BrokenGiftWrapType.NIP17DMWithRandomBase64,
      label: "NIP-17 DM with Random Base64",
      description:
        "Valid gift wrap, seal, and rumor (kind 14), but rumor content is random base64 instead of valid message",
    },
  ];

  return (
    <div className="flex flex-col gap-2 w-full mb-4">
      <label className="label">
        <span className="label-text">Broken Type</span>
      </label>
      <select
        className="select select-bordered w-full"
        value={selectedType}
        onChange={(e) => onTypeChange(e.target.value as BrokenGiftWrapType)}
      >
        {types.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>
      <label className="label">
        <span className="label-text-alt">{types.find((t) => t.value === selectedType)?.description}</span>
      </label>
    </div>
  );
}

/** Generator functions for different broken gift wrap types */
async function generateBrokenGiftWrap(pubkey: string): Promise<NostrEvent> {
  const key = generateSecretKey();
  const randomContent = generateRandomBase64Data();
  const event = finalizeEvent(
    {
      kind: kinds.GiftWrap,
      created_at: unixNow(),
      content: randomContent, // Broken: random base64 data instead of valid encrypted content
      tags: [["p", pubkey]],
    },
    key,
  );

  return event;
}

async function generateBrokenSealInGiftWrap(pubkey: string): Promise<NostrEvent> {
  // Create valid gift wrap encryption but with random base64 as seal content
  const key = generateSecretKey();
  const brokenSealContent = generateRandomBase64Data();

  const draft = {
    kind: kinds.GiftWrap,
    created_at: unixNow(),
    content: nip44.encrypt(brokenSealContent, nip44.getConversationKey(key, pubkey)),
    tags: [["p", pubkey]],
  };

  return finalizeEvent(draft, key);
}

async function generateRandomSealKindInGiftWrap(pubkey: string): Promise<NostrEvent> {
  // Create a seal with wrong kind (use kind 1 instead of 13)
  const senderPubkey = await signer.getPublicKey();
  const brokenSeal: UnsignedEvent = {
    kind: Math.floor(Math.random() * 1000), // Wrong kind - should be 13
    pubkey: senderPubkey,
    created_at: unixNow(),
    content: "",
    tags: [],
  };

  // Sign the broken seal
  const signedSeal = await signer.signEvent(brokenSeal);

  // Encrypt the broken seal in gift wrap
  const key = generateSecretKey();
  const plaintext = JSON.stringify(signedSeal);
  const draft = {
    kind: kinds.GiftWrap,
    created_at: unixNow(),
    content: nip44.encrypt(plaintext, nip44.getConversationKey(key, pubkey)),
    tags: [["p", pubkey]],
  };

  return finalizeEvent(draft, key);
}

async function generateBrokenRumorInSealInGiftWrap(pubkey: string): Promise<NostrEvent> {
  // Create a rumor with random base64 content
  const senderPubkey = await signer.getPublicKey();
  const brokenRumor: UnsignedEvent = {
    kind: kinds.PrivateDirectMessage,
    pubkey: senderPubkey,
    created_at: unixNow(),
    content: generateRandomBase64Data(), // Broken: random base64 instead of valid message
    tags: [["p", pubkey]],
  };

  const rumorId = getEventHash(brokenRumor);
  const rumorWithId = { ...brokenRumor, id: rumorId };

  // Seal the broken rumor
  const rumorPlaintext = JSON.stringify(rumorWithId);
  if (!signer.nip44) throw new Error("Signer with nip44 required");
  const encrypted = await signer.nip44.encrypt(pubkey, rumorPlaintext);

  const sealDraft: UnsignedEvent = {
    kind: kinds.Seal,
    pubkey: senderPubkey,
    created_at: unixNow(),
    content: encrypted,
    tags: [],
  };

  const seal = await signer.signEvent(sealDraft);

  // Wrap the seal in gift wrap
  const key = generateSecretKey();
  const sealPlaintext = JSON.stringify(seal);
  const giftDraft = {
    kind: kinds.GiftWrap,
    created_at: unixNow(),
    content: nip44.encrypt(sealPlaintext, nip44.getConversationKey(key, pubkey)),
    tags: [["p", pubkey]],
  };

  return finalizeEvent(giftDraft, key);
}

async function generateRandomRumorKind(pubkey: string): Promise<NostrEvent> {
  // Create a rumor with wrong kind (use kind 1 instead of 14)
  const senderPubkey = await signer.getPublicKey();
  const brokenRumor: UnsignedEvent = {
    kind: Math.floor(Math.random() * 1000), // Wrong kind - should be 14
    pubkey: senderPubkey,
    created_at: unixNow(),
    content: generateRandomBase64Data(),
    tags: [["p", pubkey]],
  };

  const rumorId = getEventHash(brokenRumor);
  const rumorWithId = { ...brokenRumor, id: rumorId };

  // Seal the broken rumor
  const rumorPlaintext = JSON.stringify(rumorWithId);
  if (!signer.nip44) throw new Error("Signer with nip44 required");
  const encrypted = await signer.nip44.encrypt(pubkey, rumorPlaintext);

  const sealDraft: UnsignedEvent = {
    kind: kinds.Seal,
    pubkey: senderPubkey,
    created_at: unixNow(),
    content: encrypted,
    tags: [],
  };

  const seal = await signer.signEvent(sealDraft);

  // Wrap the seal in gift wrap
  const key = generateSecretKey();
  const sealPlaintext = JSON.stringify(seal);
  const giftDraft = {
    kind: kinds.GiftWrap,
    created_at: unixNow(),
    content: nip44.encrypt(sealPlaintext, nip44.getConversationKey(key, pubkey)),
    tags: [["p", pubkey]],
  };

  return finalizeEvent(giftDraft, key);
}

async function generateNIP17DMWithRandomBase64(pubkey: string): Promise<NostrEvent> {
  // Create a valid rumor structure (kind 14) but with random base64 content
  const senderPubkey = await signer.getPublicKey();
  const brokenRumor: UnsignedEvent = {
    kind: kinds.PrivateDirectMessage,
    pubkey: senderPubkey,
    created_at: unixNow(),
    content: generateRandomBase64Data(), // Broken: random base64 instead of valid message
    tags: [["p", pubkey]],
  };

  const rumorId = getEventHash(brokenRumor);
  const rumorWithId = { ...brokenRumor, id: rumorId };

  // Seal the broken rumor
  const rumorPlaintext = JSON.stringify(rumorWithId);
  if (!signer.nip44) throw new Error("Signer with nip44 required");
  const encrypted = await signer.nip44.encrypt(pubkey, rumorPlaintext);

  const sealDraft: UnsignedEvent = {
    kind: kinds.Seal,
    pubkey: senderPubkey,
    created_at: unixNow(),
    content: encrypted,
    tags: [],
  };

  const seal = await signer.signEvent(sealDraft);

  // Wrap the seal in gift wrap
  const key = generateSecretKey();
  const sealPlaintext = JSON.stringify(seal);
  const giftDraft = {
    kind: kinds.GiftWrap,
    created_at: unixNow(),
    content: nip44.encrypt(sealPlaintext, nip44.getConversationKey(key, pubkey)),
    tags: [["p", pubkey]],
  };

  return finalizeEvent(giftDraft, key);
}

export default function BrokenGiftWrapGenerator() {
  const [pubkey, setPubkey] = useState<string | null>(
    () => totalRandomUsers[Math.floor(Math.random() * totalRandomUsers.length)],
  );
  const [count, setCount] = useState<number>(100);

  const [minDelay, setMinDelay] = useState<number>(100);

  const [maxDelay, setMaxDelay] = useState<number>(1000);

  const [brokenType, setBrokenType] = useState<BrokenGiftWrapType>(BrokenGiftWrapType.BrokenGiftWrap);

  const mailboxes = use$(() => (pubkey ? castUser(pubkey, eventStore).mailboxes$ : undefined), [pubkey]);
  const commands$ = useMemo(
    () =>
      new Subject<{
        pubkey: string;
        relays: string[];
        count: number;
        minDelay: number;
        maxDelay: number;
        type: BrokenGiftWrapType;
      }>(),
    [],
  );
  type Generation = {
    generating: boolean;
    error: string | null;
    success: string | null;
    eventStatuses: EventStatus[];
    currentEventIndex: number | null;
  };
  const initial: Generation = {
    generating: false,
    error: null,
    success: null,
    eventStatuses: [],
    currentEventIndex: null,
  };
  const generation =
    use$(
      () =>
        commands$.pipe(
          exhaustMap((command) =>
            defer(() => {
              const failed = new Set<string>();
              let latest: Generation = { ...initial, generating: true };
              // Invalid-event construction is intentional: this example teaches fault injection.
              const generators = {
                [BrokenGiftWrapType.BrokenGiftWrap]: generateBrokenGiftWrap,
                [BrokenGiftWrapType.BrokenSealInGiftWrap]: generateBrokenSealInGiftWrap,
                [BrokenGiftWrapType.RandomSealKindInGiftWrap]: generateRandomSealKindInGiftWrap,
                [BrokenGiftWrapType.BrokenRumorInSealInGiftWrap]: generateBrokenRumorInSealInGiftWrap,
                [BrokenGiftWrapType.RandomRumorKind]: generateRandomRumorKind,
                [BrokenGiftWrapType.NIP17DMWithRandomBase64]: generateNIP17DMWithRandomBase64,
              };
              return range(0, command.count).pipe(
                concatMap((index) =>
                  defer(() => {
                    const relays = command.relays.filter((relay) => !failed.has(relay));
                    if (!relays.length) throw new Error(`All inbox relays failed. Stopped after ${index} attempts.`);
                    const delay = index
                      ? command.minDelay +
                        Math.floor(
                          Math.random() * (Math.max(command.minDelay, command.maxDelay) - command.minDelay + 1),
                        )
                      : 0;
                    return timer(delay).pipe(
                      switchMap(() => generators[command.type](command.pubkey)),
                      switchMap((event) =>
                        pool.event(relays, event).pipe(
                          materialize(),
                          scan(
                            (statuses, notification) => {
                              const next = new Map(statuses);
                              if (notification.kind === "N") {
                                const response = notification.value;
                                next.set(response.from, { ok: response.ok, message: response.message });
                                if (!response.ok) failed.add(response.from);
                              } else {
                                for (const relay of relays)
                                  if (next.get(relay)?.message === "Pending") {
                                    next.set(relay, {
                                      ok: false,
                                      message:
                                        notification.kind === "E"
                                          ? String(notification.error?.message ?? notification.error)
                                          : "No response received",
                                    });
                                    failed.add(relay);
                                  }
                              }
                              return next;
                            },
                            new Map<string, { ok: boolean; message?: string }>(
                              command.relays.map((relay) => [
                                relay,
                                { ok: false, message: failed.has(relay) ? "Skipped (previously failed)" : "Pending" },
                              ]),
                            ),
                          ),
                          map((relayStatuses) => ({ event, index, relayStatuses }) as EventStatus),
                        ),
                      ),
                    );
                  }),
                ),
                scan((state: Generation, status): Generation => {
                  const eventStatuses = state.eventStatuses.filter((previous) => previous.index !== status.index);
                  return {
                    ...state,
                    eventStatuses: [...eventStatuses, status],
                    currentEventIndex: status.index,
                    generating: true,
                  };
                }, latest),
                tap((state) => {
                  latest = state;
                }),
                concatWith(
                  defer(() => {
                    const accepted = latest.eventStatuses.reduce(
                      (total, status) =>
                        total + [...status.relayStatuses.values()].filter((result) => result.ok).length,
                      0,
                    );
                    const attempted = latest.eventStatuses.reduce(
                      (total, status) => total + status.relayStatuses.size,
                      0,
                    );
                    return of({
                      ...latest,
                      generating: false,
                      currentEventIndex: null,
                      success: accepted ? `${accepted} of ${attempted} relay deliveries accepted` : null,
                      error: accepted ? null : "No relay accepted these events",
                    });
                  }),
                ),
                catchError((error) =>
                  of({ ...latest, generating: false, currentEventIndex: null, error: String(error.message ?? error) }),
                ),
                startWith(latest),
              );
            }),
          ),
          startWith(initial),
        ),
      [commands$],
    ) ?? initial;
  const { generating, error, success, eventStatuses, currentEventIndex } = generation;
  const handleGenerate = () => {
    if (pubkey && mailboxes?.inboxes.length)
      commands$.next({ pubkey, relays: mailboxes.inboxes, count, minDelay, maxDelay, type: brokenType });
  };

  return (
    <div className="container mx-auto max-w-4xl p-4">
      <div className="border border-base-300 bg-base-100">
        <div className="p-4 space-y-3">
          <h2 className="font-semibold text-2xl mb-4">Broken Gift Wrap Generator</h2>
          <p className="text-sm text-base-content/70 mb-4">
            Generate broken gift wrap events with random base64 data to stress test the gift wrapping system. These
            events will fail to decrypt, testing error handling and resilience. Events will be published to the target
            user's inbox relays.
          </p>

          <div className="flex flex-col gap-2 w-full mb-4">
            <label className="label">
              <span className="label-text">Target Pubkey</span>
            </label>
            <PubkeyPicker
              value={pubkey ?? ""}
              onChange={(pubkey) => setPubkey(pubkey)}
              placeholder="Enter pubkey or nostr identifier..."
            />
            <label className="label">
              <span className="label-text-alt">
                The pubkey that will receive the broken gift wrap events. Inbox relays will be loaded automatically.
              </span>
            </label>
          </div>

          <InboxRelayInfo
            pubkey={pubkey}
            inboxCount={mailboxes?.inboxes?.length ?? null}
            inboxes={mailboxes?.inboxes ?? null}
          />

          <BrokenTypeSelector selectedType={brokenType} onTypeChange={(value) => setBrokenType(value)} />

          <div className="flex flex-col gap-2 w-full mb-4">
            <label className="label">
              <span className="label-text">Number of Events</span>
            </label>
            <input
              type="number"
              min="1"
              max="100"
              className="input input-bordered w-full"
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
            />
            <label className="label">
              <span className="label-text-alt">Generate between 1 and 100 broken events</span>
            </label>
          </div>

          <DelayConfigInput
            minDelay={minDelay}
            maxDelay={maxDelay}
            onMinDelayChange={(value) => setMinDelay(value)}
            onMaxDelayChange={(value) => setMaxDelay(value)}
          />

          {error && (
            <div className="alert alert-error mb-4">
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="alert alert-success mb-4">
              <span>{success}</span>
            </div>
          )}

          <GenerateButton
            generating={generating}
            currentEventIndex={currentEventIndex}
            totalCount={count}
            disabled={generating || !pubkey || !mailboxes?.inboxes?.length}
            onClick={handleGenerate}
          />

          <EventStatusList eventStatuses={eventStatuses} currentEventIndex={currentEventIndex} totalCount={count} />
        </div>
      </div>
    </div>
  );
}
