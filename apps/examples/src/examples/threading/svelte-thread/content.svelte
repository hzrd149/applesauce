<script module lang="ts">
  import type { Note } from "applesauce-common/casts";
  import { getParsedContent } from "applesauce-content/text";

  const IMAGE_URL = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;
</script>

<script lang="ts">
  import Mention from "./mention.svelte";

  let { note, class: className = "" }: { note: Note; class?: string } = $props();

  // The parsed tree is cached on the event, so re-rendering a note doesn't parse it again
  const content = $derived(getParsedContent(note.event));
</script>

<div class="break-words {className}">
  {#each content.children as node, index (index)}
    {#if node.type === "text"}
      <span class="whitespace-pre-wrap">{node.value}</span>
    {:else if node.type === "link" && IMAGE_URL.test(node.href)}
      <a href={node.href} target="_blank" rel="noopener noreferrer">
        <img src={node.href} alt="" loading="lazy" class="my-2 max-h-96 rounded-box border border-base-300" />
      </a>
    {:else if node.type === "link"}
      <a class="link link-primary" href={node.href} target="_blank" rel="noopener noreferrer">{node.value}</a>
    {:else if node.type === "mention"}
      {#if node.decoded.type === "npub"}
        <Mention pubkey={node.decoded.data} store={note.store} />
      {:else if node.decoded.type === "nprofile"}
        <Mention pubkey={node.decoded.data.pubkey} store={note.store} />
      {:else}
        <a class="link link-primary" href="https://njump.me/{node.encoded}" target="_blank" rel="noopener noreferrer">
          {node.encoded.slice(0, 16)}…
        </a>
      {/if}
    {:else if node.type === "hashtag"}
      <span class="text-primary">#{node.name}</span>
    {:else if node.type === "emoji"}
      <img src={node.url} alt={node.raw} title={node.raw} loading="lazy" class="inline-block h-5 w-5" />
    {:else if node.type === "gallery"}
      <div class="my-2 grid grid-cols-2 gap-1">
        {#each node.links as url (url)}
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img src={url} alt="" loading="lazy" class="max-h-80 w-full rounded-box border border-base-300 object-cover" />
          </a>
        {/each}
      </div>
    {:else}
      <span class="break-all">{node.raw}</span>
    {/if}
  {/each}
</div>
