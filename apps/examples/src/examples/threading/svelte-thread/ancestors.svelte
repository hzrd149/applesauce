<script lang="ts">
  import { Note } from "applesauce-common/casts";
  import { castEventStream } from "applesauce-common/observable";
  import Ancestors from "./ancestors.svelte";
  import Post from "./post.svelte";

  type Props = { note: Note; onselect: (note: Note) => void };

  let { note, onselect }: Props = $props();

  // The event loader fetches the parent the first time the store is asked for it
  const parent$ = $derived(note.replyingTo$.pipe(castEventStream(Note, note.store)));
</script>

{#if $parent$}
  <Ancestors note={$parent$} {onselect} />
  <Post note={$parent$} {onselect} connectAbove={$parent$.isReply} connectBelow />
{/if}
