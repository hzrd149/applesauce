// Read https://github.com/nostr-protocol/nips/blob/master/59.md#overview for details on rumors and seals
// Gift wrap (signed random key) -> seal (signed sender key) -> rumor (unsigned)

/**
 * These three symbols are members of {@link PRESERVE_EVENT_SYMBOLS} (see ./pipeline.js) so the
 * factory pipe carries them across build steps. They are defined here (in core) rather than in
 * applesauce-common so PRESERVE_EVENT_SYMBOLS can be a static, load-order-independent Set.
 */

/** Used to store a reference to the seal event on gift wraps (downstream) or the seal event on rumors (upstream[]) */
export const SealSymbol = Symbol.for("seal");

/** Used to store a reference to the rumor on seals (downstream) */
export const RumorSymbol = Symbol.for("rumor");

/** Used to store a reference to the parent gift wrap event on seals (upstream) */
export const GiftWrapSymbol = Symbol.for("gift-wrap");
