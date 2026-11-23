<script module lang="ts">
  import type { Note } from "applesauce-common/casts";

  // Each level of a chain is one inline reply, deeper conversations continue on their own page
  const MAX_CHAIN = 3;

  /** Picks the reply that continues a conversation: the author answering themselves, otherwise the oldest */
  function continuation(replies: Note[], author: string): Note | undefined {
    const oldest = [...replies].sort((a, b) => a.event.created_at - b.event.created_at);
    return oldest.find((reply) => reply.event.pubkey === author) ?? oldest[0];
  }
</script>

<script lang="ts">
  import Post from "./post.svelte";
  import ReplyChain from "./reply-chain.svelte";

  type Props = { note: Note; onselect: (note: Note) => void; depth?: number };

  let { note, onselect, depth = 0 }: Props = $props();

  const replies$ = $derived(note.replies$);
  const next = $derived(continuation($replies$ ?? [], note.event.pubkey));
  const inline = $derived(next !== undefined && depth < MAX_CHAIN - 1);
</script>

<Post {note} {onselect} connectAbove={depth > 0} connectBelow={inline} />
{#if next && inline}
  <ReplyChain note={next} {onselect} depth={depth + 1} />
{:else if next}
  <button class="link block w-full border-b border-base-300 px-4 py-2 text-start link-primary" onclick={() => onselect(note)}>
    Show more replies
  </button>
{/if}
