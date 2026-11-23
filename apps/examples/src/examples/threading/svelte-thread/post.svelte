<script module lang="ts">
  import type { Note, Reaction } from "applesauce-common/casts";

  const MAX_REACTION_GROUPS = 6;

  type ReactionGroup = { content: string; url?: string; count: number };

  /** Groups the reactions that target a note by emoji, most used first */
  function groupReactions(reactions: Reaction[], noteId: string): ReactionGroup[] {
    const groups = new Map<string, ReactionGroup>();
    for (const reaction of reactions) {
      // Reactions to replies often tag the root too, only count the ones targeting this note
      if (reaction.eventPointer?.id !== noteId) continue;

      const group = groups.get(reaction.content);
      if (group) group.count++;
      else groups.set(reaction.content, { content: reaction.content, url: reaction.emoji?.url, count: 1 });
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }

  /** Formats a timestamp as a short relative time like "5m" or "3d" */
  function ago(createdAt: number): string {
    const seconds = Math.max(0, Date.now() / 1000 - createdAt);
    if (seconds < 60) return "now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
    return new Date(createdAt * 1000).toLocaleDateString();
  }
</script>

<script lang="ts">
  import Content from "./content.svelte";

  type Props = {
    note: Note;
    /** Renders the note large with its full date, as the post the thread is focused on */
    focused?: boolean;
    /** Draws the reply line from the post above into the avatar */
    connectAbove?: boolean;
    /** Draws the reply line from the avatar to the post below */
    connectBelow?: boolean;
    onselect?: (note: Note) => void;
  };

  let { note, focused = false, connectAbove = false, connectBelow = false, onselect }: Props = $props();

  // Casts are class instances, so their chained observables can be read with the $store syntax
  const profile$ = $derived(note.author.profile$);
  const replies$ = $derived(note.replies$);
  const reactions$ = $derived(note.reactions$);

  const name = $derived($profile$?.displayName || note.author.npub.slice(0, 12));
  const reactions = $derived(groupReactions($reactions$ ?? [], note.id));
  const replyCount = $derived($replies$?.length ?? 0);
</script>

{#snippet avatar()}
  {#if $profile$?.picture}
    <img src={$profile$.picture} alt="" loading="lazy" class="h-10 w-10 shrink-0 rounded-full object-cover" />
  {:else}
    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-base-300">
      {name[0]}
    </span>
  {/if}
{/snippet}

{#snippet footer()}
  <div class="mt-2 flex flex-wrap items-center gap-1">
    {#if replyCount > 0}
      <button class="btn btn-ghost btn-sm" disabled={!onselect} onclick={() => onselect?.(note)}>
        {replyCount}
        {replyCount === 1 ? "reply" : "replies"}
      </button>
    {/if}
    {#each reactions.slice(0, MAX_REACTION_GROUPS) as group (group.content)}
      <span class="badge badge-outline max-w-40 gap-1 truncate" title={group.content}>
        {#if group.url}
          <img src={group.url} alt={group.content} loading="lazy" class="h-4 w-4" />
        {:else}
          {group.content}
        {/if}
        <span class="tabular-nums">{group.count}</span>
      </span>
    {/each}
    {#if reactions.length > MAX_REACTION_GROUPS}
      <span class="badge badge-ghost">+{reactions.length - MAX_REACTION_GROUPS} more</span>
    {/if}
  </div>
{/snippet}

{#if focused}
  <article class="border-b border-base-300 px-4 pb-2">
    <div class="flex gap-3">
      <div class="flex w-10 flex-col items-center">
        <div class="h-3 w-0.5 {connectAbove ? 'bg-base-300' : ''}"></div>
        {@render avatar()}
      </div>
      <div class="flex min-w-0 flex-col justify-end">
        <span class="truncate font-semibold">{name}</span>
        <span class="truncate opacity-60">{note.author.npub.slice(0, 16)}…</span>
      </div>
    </div>
    <Content {note} class="mt-3 text-lg" />
    <p class="mt-3 opacity-60">{note.createdAt.toLocaleString()}</p>
    {@render footer()}
  </article>
{:else}
  <article class="flex gap-3 px-4 {connectBelow ? '' : 'border-b border-base-300'}">
    <div class="flex w-10 shrink-0 flex-col items-center">
      <div class="h-3 w-0.5 {connectAbove ? 'bg-base-300' : ''}"></div>
      {@render avatar()}
      {#if connectBelow}
        <div class="mt-1 w-0.5 grow bg-base-300"></div>
      {/if}
    </div>
    <div class="min-w-0 flex-1 pt-3 pb-2">
      <div class="flex items-baseline gap-2">
        <span class="truncate font-semibold">{name}</span>
        <button
          class="link shrink-0 opacity-60 link-hover"
          title={note.createdAt.toLocaleString()}
          disabled={!onselect}
          onclick={() => onselect?.(note)}
        >
          {ago(note.event.created_at)}
        </button>
      </div>
      <Content {note} class="line-clamp-[12]" />
      {@render footer()}
    </div>
  </article>
{/if}
