/**
 * Browse NIP-5D napplet manifests with their capabilities, lineage, comments, reactions and zaps
 * @tags nip-5d, napplet, feed
 * @related torrent/feed
 */
import { Comment, Napplet, User } from "applesauce-common/casts";
import { COMMENT_KIND, NAPPLET_KIND, NAPPLET_ROOT_KIND, NAPPLET_SNAPSHOT_KIND } from "applesauce-common/helpers";
import { castEventStream, castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { AddressPointer, EventPointer, Filter } from "applesauce-core/helpers";
import { createEventLoaderForStore, createReactionsLoader, createZapsLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo } from "react";
import { BehaviorSubject } from "rxjs";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

// Load profiles and referenced napplets (parent$ / root$) on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

const zapLoader = createZapsLoader(pool, { eventStore });
const reactionLoader = createReactionsLoader(pool, { eventStore });

/** Opens a napplet by its pointer so the selection survives replaceable revisions */
type Select = (pointer: AddressPointer | EventPointer | null) => void;

function AuthorName({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="font-medium">{profile?.displayName || user.npub.slice(0, 12)}</span>;
}

function Tags({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <span className="text-base-content/60">{label}:</span>
      {values.map((value) => (
        <span key={value} className="badge badge-outline">
          {value}
        </span>
      ))}
    </div>
  );
}

/** Opens the napplet in the kehto paja runtime using its NIP-19 address with outbox relay hints */
function OpenNapplet({ napplet }: { napplet: Napplet }) {
  const address = use$(napplet.address$);

  return (
    <a
      className="btn btn-primary btn-sm"
      href={`https://kehto.github.io/web/paja/?pointer=${address ?? napplet.address}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      Open
    </a>
  );
}

function NappletLink({ napplet, select }: { napplet: Napplet; select: Select }) {
  return (
    <button className="link link-primary text-left" onClick={() => select(napplet.pointer)}>
      {napplet.title || napplet.identifier || napplet.id.slice(0, 8)}
      {napplet.isSnapshot && <span className="text-base-content/60"> (snapshot {napplet.id.slice(0, 8)})</span>}
    </button>
  );
}

function NappletRow({ napplet, select }: { napplet: Napplet; select: Select }) {
  const reactions = use$(napplet.reactions$);
  const zaps = use$(napplet.zaps$);

  use$(() => zapLoader(napplet.event), [napplet.id]);
  use$(() => reactionLoader(napplet.event), [napplet.id]);

  return (
    <div
      className="border border-base-300 rounded p-4 flex flex-col gap-2 cursor-pointer hover:bg-base-200"
      onClick={() => select(napplet.pointer)}
    >
      <div className="flex items-center gap-2">
        <h3 className="font-bold text-lg flex-1">{napplet.title || napplet.identifier || "Root napplet"}</h3>
        <span className="text-sm text-base-content/60">
          {reactions?.length ?? 0} reactions · {zaps?.length ?? 0} zaps
        </span>
        <OpenNapplet napplet={napplet} />
      </div>
      <p className="whitespace-pre-wrap">{napplet.description}</p>
      <Tags label="Archetypes" values={napplet.archetypes} />
      <Tags label="Requires" values={napplet.requiredDomains} />
      <Tags label="Optional" values={napplet.optionalDomains} />
      <div className="text-sm text-base-content/60">
        by <AuthorName user={napplet.author} /> · {napplet.createdAt.toLocaleString()}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-base-300 pt-4 flex flex-col gap-2">
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <div className="border-l-2 border-base-300 pl-3">
      <AuthorName user={comment.author} />
      <p className="whitespace-pre-wrap">{comment.event.content}</p>
    </div>
  );
}

function NappletDetail({ napplet, relay, select }: { napplet: Napplet; relay: string; select: Select }) {
  const comments = use$(napplet.comments$);
  const reactions = use$(napplet.reactions$);
  const zaps = use$(napplet.zaps$);
  const snapshots = use$(napplet.snapshots$);
  const lineage = use$(napplet.lineage$);
  const parent = use$(napplet.parent$);
  const root = use$(napplet.root$);

  // Fetch the direct comments (matching comments$) and snapshots that reference this napplet
  use$(() => {
    const filters: Filter[] = napplet.coordinate
      ? [
          { kinds: [COMMENT_KIND], "#a": [napplet.coordinate] },
          { kinds: [NAPPLET_SNAPSHOT_KIND], "#a": [napplet.coordinate] },
          { kinds: [NAPPLET_SNAPSHOT_KIND], "#A": [napplet.coordinate] },
        ]
      : [{ kinds: [COMMENT_KIND], "#e": [napplet.id] }];
    return pool.relay(relay).subscription(filters).pipe(mapEventsToStore(eventStore));
  }, [napplet.id, relay]);

  use$(() => zapLoader(napplet.event), [napplet.id]);
  use$(() => reactionLoader(napplet.event), [napplet.id]);

  const sats = Math.round((zaps?.reduce((sum, zap) => sum + zap.amount, 0) ?? 0) / 1000);

  return (
    <div className="max-w-4xl w-full mx-auto my-8 px-4 flex flex-col gap-4">
      <button className="btn btn-ghost self-start" onClick={() => select(null)}>
        Back to napplets
      </button>

      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{napplet.title || napplet.identifier || "Root napplet"}</h1>
          <div className="text-sm text-base-content/60">
            by <AuthorName user={napplet.author} /> · kind {napplet.kind}
          </div>
        </div>
        <OpenNapplet napplet={napplet} />
      </div>
      <p className="whitespace-pre-wrap">{napplet.description}</p>

      <div className="flex flex-col gap-1 text-sm">
        <div>
          <span className="text-base-content/60">Artifact: </span>
          <code className="break-all">{napplet.artifactHash}</code>
        </div>
        {napplet.source && (
          <div>
            <span className="text-base-content/60">Source: </span>
            <a className="link" href={napplet.source} target="_blank" rel="noreferrer">
              {napplet.source}
            </a>
          </div>
        )}
        <Tags label="Archetypes" values={napplet.archetypes} />
        <Tags label="Intents" values={napplet.intents.map((i) => [i.intent, ...i.params].join(" "))} />
        <Tags label="Requires" values={napplet.requiredDomains} />
        <Tags label="Optional" values={napplet.optionalDomains} />
        <Tags label="Servers" values={napplet.servers} />
      </div>

      {napplet.isSnapshot && (
        <Section title="Lineage">
          <div>Parent: {parent ? <NappletLink napplet={parent} select={select} /> : <span>not loaded</span>}</div>
          <div>Root: {root ? <NappletLink napplet={root} select={select} /> : <span>not loaded</span>}</div>
        </Section>
      )}

      {!napplet.isSnapshot && (
        <Section title={`Snapshots (${snapshots?.length ?? 0} direct, ${lineage?.length ?? 0} in lineage)`}>
          {lineage?.map((snapshot) => (
            <NappletLink key={snapshot.id} napplet={snapshot} select={select} />
          ))}
        </Section>
      )}

      <Section title={`Reactions (${reactions?.length ?? 0}) · Zaps (${zaps?.length ?? 0}, ${sats} sats)`}>
        <div className="flex flex-wrap gap-1">
          {reactions?.map((reaction) => (
            <span key={reaction.id} className="badge badge-outline">
              {reaction.content || "+"}
            </span>
          ))}
        </div>
      </Section>

      <Section title={`Comments (${comments?.length ?? 0})`}>
        {comments?.map((comment) => (
          <CommentItem key={comment.id} comment={comment} />
        ))}
      </Section>
    </div>
  );
}

/** Resolves the selected pointer from the store so the detail view follows new revisions */
function SelectedNapplet(props: { pointer: AddressPointer | EventPointer; relay: string; select: Select }) {
  const { pointer, relay, select } = props;
  const napplet = use$(() => eventStore.event(pointer).pipe(castEventStream(Napplet, eventStore)), [pointer]);

  if (!napplet) return <span className="loading loading-spinner loading-lg self-center my-8" />;
  return <NappletDetail napplet={napplet} relay={relay} select={select} />;
}

export default function NappletBrowser() {
  const relay$ = useMemo(() => new BehaviorSubject("wss://relay.primal.net/"), []);
  const selected$ = useMemo(() => new BehaviorSubject<AddressPointer | EventPointer | null>(null), []);
  const relay = use$(relay$);
  const selected = use$(selected$);
  const select: Select = (pointer) => selected$.next(pointer);

  use$(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [NAPPLET_ROOT_KIND, NAPPLET_KIND], limit: 200 })
        .pipe(mapEventsToStore(eventStore)),
    [relay],
  );

  const napplets = use$(
    () =>
      eventStore.timeline({ kinds: [NAPPLET_ROOT_KIND, NAPPLET_KIND] }).pipe(castTimelineStream(Napplet, eventStore)),
    [],
  );

  if (selected) return <SelectedNapplet pointer={selected} relay={relay} select={select} />;

  return (
    <div className="max-w-4xl w-full mx-auto my-8 px-4 flex flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold mb-2">Napplet Browser</h1>
        <p className="text-base-content/60 mb-4">Sandboxed Nostr web applets (NIP-5D) published as manifest events</p>
        <RelayPicker value={relay} onChange={(url) => relay$.next(url)} />
      </div>

      {napplets === undefined ? (
        <span className="loading loading-spinner loading-lg self-center" />
      ) : napplets.length === 0 ? (
        <p className="text-center py-12 text-base-content/60">No napplets found. Try a different relay.</p>
      ) : (
        napplets.map((napplet) => <NappletRow key={napplet.id} napplet={napplet} select={select} />)
      )}
    </div>
  );
}
