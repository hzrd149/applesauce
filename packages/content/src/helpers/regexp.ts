const Expressions = {
  get cashu() {
    return /(cashu(?:A|B)[A-Za-z0-9_-]{100,10000}={0,3})/gi;
  },
  get nostrLink() {
    return /(?:nostr:)?((npub|note|nprofile|nevent|nrelay|naddr)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58,})/gi;
  },
  get emoji() {
    return /:([a-zA-Z0-9_-]+):/gi;
  },
};

export default Expressions;
