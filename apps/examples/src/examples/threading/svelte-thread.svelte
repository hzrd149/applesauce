<script module lang="ts">
  /**
   * Render a NIP-10 thread as a social feed in Svelte 5, with parent context, a focused post and reply chains built from casts
   * @tags svelte, nip-10, nip-25, nip-65, thread, replies, reactions, casts
   * @related threading/thread-loading
   */
  import { Note } from "applesauce-common/casts";
  import { castEventStream } from "applesauce-common/observable";
  import { defined, EventStore, mapEventsToStore } from "applesauce-core";
  import { kinds, mergeRelaySets, type EventPointer } from "applesauce-core/helpers";
  import { decodeEventPointer } from "applesauce-core/helpers/pointers";
  import { createEventLoaderForStore } from "applesauce-loaders/loaders";
  import { RelayPool } from "applesauce-relay";
  import {
    bufferCount,
    concat,
    defer,
    distinctUntilChanged,
    from,
    map,
    mergeMap,
    of,
    startWith,
    switchMap,
    take,
    type Observable,
  } from "rxjs";
  import { verifyEvent } from "../../extra/verifier";
  import { lookupRelays$ } from "../../settings";

  type ThreadPreset = { label: string; pointer: EventPointer };

  // Threads by gigi with nested replies, probed with nak on 2026-11-23
  const GIGI = "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93";

  const THREAD_PRESETS: ThreadPreset[] = [
    {
      label: "How many GMs are left",
      pointer: {
        id: "0000075fa1aa90c695dff68ff6c62b709154629b248ae78be0f3560d566d91c9",
        author: GIGI,
        relays: ["wss://relay.primal.net/"],
      },
    },
    {
      label: "GM from the haven",
      pointer: {
        id: "000004272f442f3b9092032b9c5ed58facd502ad06697943b1eb1b3bfe595a54",
        author: GIGI,
        relays: ["wss://relay.primal.net/"],
      },
    },
    {
      label: "A crazy website",
      pointer: {
        id: "00000045e1a5682aaf5e390c5487292c519823f5365961833c10d7afc7beadd4",
        author: GIGI,
        relays: ["wss://relay.primal.net/"],
      },
    },
  ];

  const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];

  // Reactions are requested by the ids of thread events, a batch keeps each REQ filter a reasonable size
  const REACTION_BATCH = 250;

  // Class instances are never proxied by Svelte, so they can live at module level
  const eventStore = new EventStore({ verifyEvent });
  const pool = new RelayPool();

  // Parents, profiles and relay lists load on demand when a component subscribes to them
  createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

  /** Parses a hex id, note1, or nevent (with or without "nostr:") into an event pointer */
  function parseThreadInput(text: string): EventPointer | null {
    const value = text.trim().replace(/^nostr:/, "");
    if (/^[0-9a-f]{64}$/i.test(value)) return { id: value.toLowerCase() };

    try {
      return decodeEventPointer(value);
    } catch {
      return null;
    }
  }

  /** The root of the thread a note belongs to, or the note itself when it starts the thread */
  function threadRoot(note: Note): EventPointer {
    return note.references.root?.e ?? { id: note.id, author: note.event.pubkey };
  }

  /** Requests reactions to the root and every reply in the store, a few batches at a time */
  function loadReactions$(relays: string[], rootId: string) {
    return defer(() => {
      const replies = eventStore.getByFilters({ kinds: [kinds.ShortTextNote], "#e": [rootId] });
      const ids = [rootId, ...replies.map((reply) => reply.id)];

      return from(ids).pipe(
        bufferCount(REACTION_BATCH),
        mergeMap((batch) => pool.request(relays, { kinds: [kinds.Reaction], "#e": batch }), 2),
      );
    });
  }

  /** Loads every reply in the focused note's thread, then their reactions, from the hints and the author's inboxes */
  function loadThread$(focus: EventPointer): Observable<unknown> {
    return eventStore.event(focus).pipe(
      castEventStream(Note, eventStore),
      defined(),
      take(1),
      switchMap((note) => {
        const root = threadRoot(note);

        // Replies are published to the inboxes of the author they reply to, start with the hints while those load
        return note.author.inboxes$.pipe(
          startWith(undefined),
          map((inboxes) => mergeRelaySets(focus.relays, root.relays, inboxes ?? [])),
          map((relays) => (relays.length > 0 ? relays : FALLBACK_RELAYS)),
          distinctUntilChanged((a, b) => a.join() === b.join()),
          // A larger relay set replaces the previous request, the store keeps what already arrived
          switchMap((relays) =>
            concat(
              pool.request(relays, { kinds: [kinds.ShortTextNote], "#e": [root.id] }),
              loadReactions$(relays, root.id),
            ),
          ),
        );
      }),
      mapEventsToStore(eventStore),
    );
  }

  /** Orders replies like a feed: the author continuing their own thread first, then oldest first */
  function sortReplies(replies: Note[], author: string): Note[] {
    return [...replies].sort((a, b) => {
      const byAuthor = Number(b.event.pubkey === author) - Number(a.event.pubkey === author);
      return byAuthor || a.event.created_at - b.event.created_at;
    });
  }
</script>

<script lang="ts">
  import Ancestors from "./svelte-thread/ancestors.svelte";
  import Post from "./svelte-thread/post.svelte";
  import ReplyChain from "./svelte-thread/reply-chain.svelte";

  // A pointer, never an event: $state would wrap an event in a proxy that breaks its caches
  let focus = $state.raw<EventPointer>(THREAD_PRESETS[0].pointer);
  let input = $state("");
  let scroller = $state<HTMLElement>();

  const parsed = $derived(input.trim() ? parseThreadInput(input) : null);

  // The loader only fills the store, so it is subscribed in an effect and replaced when the focus changes
  $effect(() => {
    const sub = loadThread$(focus).subscribe();
    return () => sub.unsubscribe();
  });

  const note$ = $derived(eventStore.event(focus).pipe(castEventStream(Note, eventStore)));
  const replies$ = $derived($note$ ? $note$.replies$ : of([]));
  const replies = $derived($note$ ? sortReplies($replies$, $note$.event.pubkey) : []);

  // Every note that tags the thread root, for the counts in the sidebar
  const rootId = $derived($note$ ? threadRoot($note$).id : focus.id);
  const thread$ = $derived(eventStore.timeline({ kinds: [kinds.ShortTextNote], "#e": [rootId] }));
  const participants = $derived(new Set($thread$.map((event) => event.pubkey)).size);

  function select(note: Note) {
    // Kind 1 notes are not replaceable, so their pointer is always an event pointer with seen relays as hints
    focus = note.pointer as EventPointer;
    scroller?.scrollTo({ top: 0 });
  }

  function open(event: SubmitEvent) {
    event.preventDefault();
    if (!parsed) return;

    focus = parsed;
    input = "";
  }
</script>

<div class="flex min-h-0 grow">
  <aside class="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-e border-base-300 p-3">
    <section class="flex flex-col gap-1">
      <h2 class="font-semibold">Thread</h2>
      {#each THREAD_PRESETS as preset (preset.pointer.id)}
        <label class="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            class="radio radio-sm mt-1"
            checked={focus.id === preset.pointer.id}
            onchange={() => (focus = preset.pointer)}
          />
          {preset.label}
        </label>
      {/each}
    </section>

    <form class="flex flex-col gap-1" onsubmit={open}>
      <div class="join">
        <input class="input join-item w-full" placeholder="nevent, note1 or hex id" bind:value={input} />
        <button class="btn join-item" disabled={!parsed}>Open</button>
      </div>
      {#if input.trim() && !parsed}
        <span class="text-sm text-error">Not a valid event id</span>
      {/if}
    </form>

    <div class="flex flex-wrap gap-2">
      <span class="badge badge-outline">{$thread$.length} replies</span>
      <span class="badge badge-outline">{participants} people</span>
    </div>
  </aside>

  <main bind:this={scroller} class="min-w-0 flex-1 overflow-y-auto">
    <div class="mx-auto min-h-full max-w-2xl border-x border-base-300">
      {#if $note$}
        <Ancestors note={$note$} onselect={select} />
        <Post note={$note$} focused connectAbove={$note$.isReply} />
        {#each replies as reply (reply.id)}
          <ReplyChain note={reply} onselect={select} />
        {/each}
      {:else}
        <p class="p-4 opacity-60">Note not found yet</p>
      {/if}
    </div>
  </main>
</div>
