# Text Content

## Parsing content

The [`getParsedContent`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-content.Text.getParsedContent.html) method can be used to parse and transform an event into the content syntax tree

## Cashing

Because parsing and transforming content is an expensive operation `getParsedContent` method will cache the results on the event under a [Symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol), by default this is the [`TextNoteContentSymbol`](https://hzrd149.github.io/applesauce/typedoc/variables/applesauce-content.Text.TextNoteContentSymbol.html)

If your parsing or transforming different event kinds than kind 1, its recommended to create a new `Symbol` to and pass to `getParsedContent` to avoid cache collisions with the default kind 1 processor

## Links

The [`links`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-content.Text.links.html) transformer can be used to parse URLs and add [`Link`](https://hzrd149.github.io/applesauce/typedoc/interfaces/applesauce-content.Nast.Link.html) nodes to the tree

## Mentions

The [`nostrMentions`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-content.Text.nostrMentions.html) transformer can be used to add [`Mention`](https://hzrd149.github.io/applesauce/typedoc/interfaces/applesauce-content.Nast.Mention.html) nodes to the tree

## Hashtags

The [`hashtags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-content.Text.hashtags.html) transformer can be used to add [`Hashtag`](https://hzrd149.github.io/applesauce/typedoc/interfaces/applesauce-content.Nast.Hashtag.html) nodes to the tree

## Emojis

The [`emojis`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-content.Text.emojis.html) transformer will add [`Emoji`](https://hzrd149.github.io/applesauce/typedoc/interfaces/applesauce-content.Nast.Emoji.html) tags for any [NIP-30](https://github.com/nostr-protocol/nips/blob/master/30.md) emojis

## Galleries

The [`galleries`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-content.Text.galleries.html) transformer will group image URLs into a [`Gallery`](https://hzrd149.github.io/applesauce/typedoc/interfaces/applesauce-content.Nast.Gallery.html) node

## Lightning invoices

The [`lightningInvoices`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-content.Text.lightningInvoices.html) transformer can be used to parse bolt11 lightning invoices in the content

## Cashu tokens and payment requests

The [`cashuTokens`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-content.Text.cashuTokens.html) transformer can be used to parse cashu tokens in the content
