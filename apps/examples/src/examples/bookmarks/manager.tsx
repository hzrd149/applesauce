/**
 * Manage your public and hidden NIP-51 bookmarks, loading each bookmarked article from its author's outboxes and each note from your inboxes and outboxes
 * @tags nip-51, nip-65, bookmarks, manager, outbox, actions
 * @related feed/relay-timeline, articles/blog
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { BookmarkEvent, UnbookmarkEvent } from "applesauce-actions/actions";
import { Article, BookmarksList, castUser, Note, User } from "applesauce-common/casts";
import { castEventStream } from "applesauce-common/observable";
import type { BookmarkPointer } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import {
  decodePointer,
  encodePointer,
  getDisplayName,
  getOrComputeCachedValue,
  getProfilePicture,
  getReplaceableAddressFromPointer,
  getTagValue,
  isAddressPointer,
  isAudioURL,
  isImageURL,
  isStreamURL,
  isVideoURL,
  mergeRelaySets,
  type NostrEvent,
  Tokens,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ISigner } from "applesauce-signers";
import { Check, Copy, Lock, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
  auditTime,
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  filter,
  map,
  type Observable,
  of,
  startWith,
  switchMap,
  timeout,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import NoteContent from "../../components/note-content";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Bookmarks load from the outbox relays passed as hints, popular relays are only a last resort
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

// Publish to the relays the action picked (the user's outboxes), falling back when there are none
const actions = new ActionRunner(eventStore, new ProxySigner(signer$), async (event, relays) => {
  const responses = await pool.publish(relays?.length ? relays : FALLBACK_RELAYS, event);
  if (!responses.some((r) => r.ok)) throw new Error(responses[0]?.message ?? "No relay accepted the bookmarks");
});

type Kind = "all" | "notes" | "articles";
type Media = "image" | "video" | "audio" | "link" | "quote";
type Bookmark = { pointer: BookmarkPointer; hidden: boolean };
/** A bookmark with the relays it is being loaded from and its cast once found */
type Loaded = Bookmark & { relays?: string[]; item?: Note | Article };

const MEDIA: { value: Media; label: string }[] = [
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "link", label: "Links" },
  { value: "quote", label: "Quotes" },
];

const keyOf = (pointer: BookmarkPointer) =>
  isAddressPointer(pointer) ? getReplaceableAddressFromPointer(pointer) : pointer.id;

/** Merges relay lists as they are discovered, falling back to no hints if none load */
function discovered$(...sources: Observable<string[] | undefined>[]): Observable<string[]> {
  return combineLatest(sources.map((relays$) => relays$.pipe(map((relays) => relays ?? [])))).pipe(
    map((sets) => mergeRelaySets(...sets)),
    distinctUntilChanged((a, b) => a.join() === b.join()),
    // Wait for at least one relay so bookmarks don't skip straight to the fallback relays
    filter((relays) => relays.length > 0),
    timeout({ first: 10_000, with: () => of([]) }),
  );
}

/** Picks the relays to load a bookmark from, growing as the outboxes it depends on are discovered */
function bookmarkRelays$(user: User, pointer: BookmarkPointer): Observable<string[]> {
  if (isAddressPointer(pointer)) return discovered$(of(pointer.relays), castUser(pointer.pubkey, eventStore).outboxes$);

  // Bookmarked "e" tags have no author, so search everywhere the user reads and writes
  return discovered$(
    of(pointer.relays),
    pointer.author ? castUser(pointer.author, eventStore).outboxes$ : of([]),
    user.inboxes$,
    user.outboxes$,
  );
}

/** Loads a bookmarked note or article from the given relays */
function bookmark$(pointer: BookmarkPointer, relays: string[]): Observable<Note | Article | undefined> {
  return isAddressPointer(pointer)
    ? eventStore.replaceable({ ...pointer, relays }).pipe(castEventStream(Article, eventStore))
    : eventStore.event({ ...pointer, relays }).pipe(castEventStream(Note, eventStore));
}

/** Loads a bookmark from its discovered relays and casts it to a note or article */
function loaded$(user: User, bookmark: Bookmark): Observable<Loaded> {
  const { pointer } = bookmark;
  return bookmarkRelays$(user, pointer).pipe(
    // Each newly discovered outbox re-requests the bookmark from the larger relay set
    switchMap((relays) => bookmark$(pointer, relays).pipe(map((item) => ({ ...bookmark, relays, item })))),
    startWith(bookmark),
  );
}

/** Loads every public and hidden bookmark, newest first */
function bookmarks$(user: User, list: BookmarksList | undefined, hidden: BookmarkPointer[] | undefined) {
  // Newest bookmarks are appended to the end of the list
  const bookmarks: Bookmark[] = [
    ...(hidden ?? []).map((pointer) => ({ pointer, hidden: true })),
    ...(list?.bookmarks ?? []).map((pointer) => ({ pointer, hidden: false })),
  ].reverse();
  if (bookmarks.length === 0) return of([]);

  // Bookmarks resolve one by one, batch the re-renders
  return combineLatest(bookmarks.map((b) => loaded$(user, b))).pipe(auditTime(100));
}

const MediaSymbol = Symbol("bookmark-media");

/** Finds the kinds of media an event's content links to */
function getMedia(event: NostrEvent): Set<Media> {
  return getOrComputeCachedValue(event, MediaSymbol, () => {
    const media = new Set<Media>();
    if (getTagValue(event, "image")) media.add("image");
    for (const [url] of event.content.matchAll(Tokens.link)) {
      if (isImageURL(url)) media.add("image");
      else if (isVideoURL(url) || isStreamURL(url)) media.add("video");
      else if (isAudioURL(url)) media.add("audio");
      else media.add("link");
    }
    if (Tokens.nostrLink.test(event.content)) media.add("quote");
    return media;
  });
}

/** Toggles a value in a set, returning a new set */
const toggle = <T,>(set: Set<T>, value: T) => {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
};

function logout() {
  // Stop the login view from restoring this account when it mounts again
  forgetActiveAccount();
  signer$.next(undefined);
  user$.next(undefined);
}

/** Parses a pasted nevent, note or naddr */
function parsePointer(input: string): BookmarkPointer | undefined {
  try {
    const result = decodePointer(input.trim().replace(/^nostr:/, ""));
    if (result.type === "nevent" || result.type === "naddr") return result.data;
    if (result.type === "note") return { id: result.data };
  } catch {}
  return undefined;
}

function Avatar({ user, size = "h-6 w-6" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)}
      className={`${size} shrink-0 rounded-full`}
    />
  );
}

function Name({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="min-w-0 truncate font-medium">{getDisplayName(profile, user.npub.slice(0, 12))}</span>;
}

function Byline({ user, time }: { user: User; time: Date }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Avatar user={user} />
      <Name user={user} />
      <span className="opacity-60">{time.toLocaleDateString()}</span>
    </div>
  );
}

function NotePreview({ note }: { note: Note }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Byline user={note.author} time={note.createdAt} />
      <div className="line-clamp-4 whitespace-pre-wrap break-words">
        <NoteContent event={note.event} maxLength={500} />
      </div>
    </div>
  );
}

function ArticlePreview({ article }: { article: Article }) {
  return (
    <div className="flex min-w-0 gap-3">
      {article.image && <img src={article.image} className="h-20 aspect-video shrink-0 object-cover" />}
      <div className="flex min-w-0 flex-col gap-1">
        <Byline user={article.author} time={article.publishedDate} />
        <span className="font-semibold">{article.title || "Untitled"}</span>
        <p className="line-clamp-2 text-sm opacity-70">{article.summary}</p>
      </div>
    </div>
  );
}

/** Encodes the bookmark as a nevent or naddr, with the relays it was seen on as hints */
function getNip19(pointer: BookmarkPointer, item?: Note | Article) {
  const relays = mergeRelaySets(item?.seen, pointer.relays).slice(0, 3);
  return encodePointer({ ...(item?.pointer ?? pointer), relays });
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  return (
    <button className="btn btn-ghost btn-sm btn-square" title={value} onClick={copy}>
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function BookmarkRow({ bookmark, onRemove }: { bookmark: Loaded; onRemove?: () => void }) {
  const { pointer, hidden, relays, item } = bookmark;

  return (
    <div className="flex items-start gap-3 border-b border-base-300 p-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        {item instanceof Article ? (
          <ArticlePreview article={item} />
        ) : item ? (
          <NotePreview note={item} />
        ) : (
          <div className="flex items-center gap-2 opacity-60">
            <span className="loading loading-spinner loading-sm" />
            <span className="truncate font-mono text-sm">{keyOf(pointer)}</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {hidden && <Lock className="h-4 w-4 opacity-60" aria-label="Hidden" />}
        <CopyButton value={getNip19(pointer, item)} />
        <span className="badge badge-ghost" title={relays?.join("\n")}>
          {relays ? `${relays.length} relays` : "…"}
        </span>
        {onRemove && (
          <button className="btn btn-ghost btn-sm btn-square" title="Remove" onClick={onRemove}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function AddBookmark({ user }: { user: User }) {
  const [input, setInput] = useState("");
  const [hidden, setHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();

  const pointer = useMemo(() => parsePointer(input), [input]);
  const preview = use$(() => (pointer ? loaded$(user, { pointer, hidden: false }) : undefined), [user, pointer]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pointer) return;
    setAdding(true);
    setError(undefined);
    try {
      // Bookmark the loaded event so the tag carries a relay hint
      await actions.run(BookmarkEvent, preview?.item?.event ?? pointer, undefined, hidden);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add bookmark");
    } finally {
      setAdding(false);
    }
  };

  return (
    <form onSubmit={add} className="flex flex-col border-b border-base-300">
      <div className="flex gap-2 p-3">
        <input
          className="input input-bordered flex-1"
          placeholder="nevent, note or naddr"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <label className="label">
          <input type="checkbox" className="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Hidden
        </label>
        <button className="btn btn-primary" disabled={!pointer || adding}>
          {adding ? <span className="loading loading-spinner loading-sm" /> : "Add"}
        </button>
      </div>
      {preview && (
        <div className="border-t border-base-300">
          <BookmarkRow bookmark={{ ...preview, hidden }} />
        </div>
      )}
      {error && <div className="border-t border-base-300 p-3 text-sm text-error">{error}</div>}
    </form>
  );
}

function Account({ user }: { user: User }) {
  const outboxes = use$(user.outboxes$);
  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-2">
      <Avatar user={user} size="h-8 w-8" />
      <Name user={user} />
      <span className="ms-auto badge badge-ghost" title={outboxes?.join("\n")}>
        {outboxes ? `${outboxes.length} outboxes` : "…"}
      </span>
      <button className="btn btn-sm btn-ghost" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-base-300 p-3">
      <span className="text-sm opacity-60">{title}</span>
      {children}
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`btn btn-sm justify-start gap-2 ${active ? "btn-active" : "btn-ghost"}`} onClick={onClick}>
      {children}
    </button>
  );
}

function BookmarkManager({ user }: { user: User }) {
  const signer = use$(signer$);
  const list = use$(user.bookmarks$);
  const hidden = use$(() => list?.hidden$, [list]);
  const bookmarks = use$(() => bookmarks$(user, list, hidden), [user, list, hidden]);

  const [kind, setKind] = useState<Kind>("all");
  const [media, setMedia] = useState(new Set<Media>());
  const [authors, setAuthors] = useState(new Set<string>());
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string>();

  // Count kinds, media and authors across the loaded bookmarks
  const stats = useMemo(() => {
    const kinds = { all: 0, notes: 0, articles: 0 };
    const media = new Map<Media, number>();
    const authors = new Map<string, { user: User; count: number }>();
    for (const b of bookmarks ?? []) {
      kinds.all++;
      kinds[isAddressPointer(b.pointer) ? "articles" : "notes"]++;
      if (!b.item) continue;
      for (const m of getMedia(b.item.event)) media.set(m, (media.get(m) ?? 0) + 1);
      const author = authors.get(b.item.author.pubkey) ?? { user: b.item.author, count: 0 };
      authors.set(author.user.pubkey, { ...author, count: author.count + 1 });
    }
    return { kinds, media, authors: [...authors.values()].sort((a, b) => b.count - a.count) };
  }, [bookmarks]);

  // Media and author filters only match bookmarks that have loaded
  const visible = (bookmarks ?? []).filter((b) => {
    if (kind !== "all" && (kind === "articles") !== isAddressPointer(b.pointer)) return false;
    if (media.size > 0 && !(b.item && [...getMedia(b.item.event)].some((m) => media.has(m)))) return false;
    if (authors.size > 0 && !(b.item && authors.has(b.item.author.pubkey))) return false;
    return true;
  });

  const unlock = async () => {
    if (!list || !signer) return;
    setUnlocking(true);
    setError(undefined);
    try {
      await list.unlock(signer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock hidden bookmarks");
    } finally {
      setUnlocking(false);
    }
  };

  const remove = (bookmark: Bookmark) =>
    actions
      .run(UnbookmarkEvent, bookmark.pointer, undefined, bookmark.hidden)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-72 shrink-0 flex-col border-e border-base-300">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title="Type">
            {(["all", "notes", "articles"] as const).map((k) => (
              <Toggle key={k} active={kind === k} onClick={() => setKind(k)}>
                <span className="capitalize">{k}</span>
                <span className="ms-auto opacity-60">{stats.kinds[k]}</span>
              </Toggle>
            ))}
          </Section>

          <Section title="Content">
            {MEDIA.map((m) => (
              <Toggle key={m.value} active={media.has(m.value)} onClick={() => setMedia(toggle(media, m.value))}>
                {m.label}
                <span className="ms-auto opacity-60">{stats.media.get(m.value) ?? 0}</span>
              </Toggle>
            ))}
          </Section>

          <Section title="Authors">
            {stats.authors.map(({ user, count }) => (
              <Toggle
                key={user.pubkey}
                active={authors.has(user.pubkey)}
                onClick={() => setAuthors(toggle(authors, user.pubkey))}
              >
                <Avatar user={user} />
                <Name user={user} />
                <span className="ms-auto opacity-60">{count}</span>
              </Toggle>
            ))}
          </Section>
        </div>
        <Account user={user} />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <AddBookmark user={user} />

        {list?.hasHidden && !hidden && (
          <div className="flex items-center gap-2 border-b border-base-300 p-3">
            <button className="btn btn-sm" onClick={unlock} disabled={unlocking}>
              {unlocking ? <span className="loading loading-spinner loading-sm" /> : <Lock className="h-4 w-4" />}
              Unlock hidden bookmarks
            </button>
          </div>
        )}

        {error && <div className="border-b border-base-300 p-3 text-sm text-error">{error}</div>}

        {!list || !bookmarks ? (
          <div className="flex justify-center p-6">
            <span className="loading loading-dots" />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-6 text-center opacity-60">No bookmarks</div>
        ) : (
          visible.map((bookmark) => (
            <BookmarkRow
              key={`${bookmark.hidden}:${keyOf(bookmark.pointer)}`}
              bookmark={bookmark}
              onRemove={() => remove(bookmark)}
            />
          ))
        )}
      </main>
    </div>
  );
}

export default function App() {
  const signer = use$(signer$);
  const user = use$(user$);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  if (!signer || !user) return <LoginView onLogin={handleLogin} />;
  return <BookmarkManager key={user.pubkey} user={user} />;
}
