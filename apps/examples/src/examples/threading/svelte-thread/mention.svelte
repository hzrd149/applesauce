<script lang="ts">
  import { castUser, type CastRefEventStore } from "applesauce-core";

  let { pubkey, store }: { pubkey: string; store: CastRefEventStore } = $props();

  const user = $derived(castUser(pubkey, store));
  const profile$ = $derived(user.profile$);
</script>

<a class="link link-primary" href="https://njump.me/{user.npub}" target="_blank" rel="noopener noreferrer">
  @{$profile$?.displayName || user.npub.slice(0, 12)}
</a>
