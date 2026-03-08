# Nostr NIP Implementation Audit

**Audit Date:** 2026-03-08  
**Codebase:** applesauce (all packages)  
**Total NIPs Audited:** 70+

---

## Executive Summary

| Status                   | Count | Percentage |
| ------------------------ | ----- | ---------- |
| ✅ Fully Implemented     | 43    | 61%        |
| ⚠️ Partially Implemented | 7     | 10%        |
| ❌ Not Implemented       | 20    | 29%        |

---

## ✅ Fully Implemented NIPs (42)

### Core Protocol

| NIP        | Description               | Kinds    | Key Files                                                                                        |
| ---------- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| **NIP-01** | Basic Protocol Flow       | -        | `relay/relay.ts`, `relay/pool.ts`, `relay/group.ts`                                              |
| **NIP-02** | Follow List               | 3        | `actions/contacts.ts`, `core/helpers/contacts.ts`, `loaders/social-graph.ts`                     |
| **NIP-04** | Encrypted Direct Messages | 4        | `common/factories/legacy-message.ts`, `core/helpers/encryption.ts`, all signers                  |
| **NIP-09** | Event Deletion            | 5        | `core/factories/delete.ts`, `core/operations/delete.ts`, `core/helpers/delete.ts`                |
| **NIP-10** | Text Notes & Threading    | -        | `common/helpers/threading.ts`, `common/models/thread.ts`, `common/operations/note.ts`            |
| **NIP-17** | Private Direct Messages   | 14       | `common/operations/gift-wrap.ts`, `common/factories/wrapped-message.ts`                          |
| **NIP-18** | Reposts                   | 6, 16    | `common/factories/share.ts`, `common/operations/share.ts`, `common/helpers/share.ts`             |
| **NIP-19** | bech32 Encoding           | -        | `core/helpers/pointers.ts`                                                                       |
| **NIP-21** | nostr: URI Scheme         | -        | `core/helpers/regexp.ts`, `core/operations/content.ts`, `content/markdown/mentions.ts`           |
| **NIP-25** | Reactions                 | 7        | `common/factories/reaction.ts`, `common/operations/reaction.ts`, `common/helpers/emoji.ts`       |
| **NIP-27** | Text Note References      | -        | `core/operations/content.ts`, `core/helpers/pointers.ts`                                         |
| **NIP-36** | Sensitive Content         | -        | `core/operations/content.ts`, `core/factories/event.ts`, `common/helpers/content.ts`             |
| **NIP-40** | Expiration Timestamp      | -        | `core/helpers/expiration.ts`, `core/operations/event.ts`, `event-store/expiration-manager.ts`    |
| **NIP-42** | Relay Authentication      | 22242    | `relay/relay.ts` (via nostr-tools/nip42)                                                         |
| **NIP-44** | Encrypted Payloads (v2)   | -        | All signers, `core/helpers/encryption.ts`, `wallet-connect/`                                     |
| **NIP-45** | COUNT Message             | -        | `relay/relay.ts` (lines 675-708)                                                                 |
| **NIP-49** | Private Key Encryption    | -        | `core/helpers/keys.ts`, `signers/password-signer.ts` (ncryptsec)                                 |
| **NIP-59** | Gift Wrap                 | 13, 1059 | `common/factories/gift-wrap.ts`, `common/operations/gift-wrap.ts`, `common/helpers/gift-wrap.ts` |
| **NIP-70** | Protected Events          | -        | `core/operations/event.ts`, `core/helpers/event.ts` (`"-"` tag)                                  |
| **NIP-77** | Negentropy Syncing        | -        | `relay/negentropy.ts`, `relay/relay.ts`, `relay/group.ts`                                        |
| **NIP-98** | HTTP Auth                 | 27235    | `relay/management.ts` (via nostr-tools/nip98)                                                    |

### Lists & Social

| NIP        | Description         | Kinds                            | Key Files                                                                                                         |
| ---------- | ------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **NIP-28** | Public Chat         | 40-44                            | `common/helpers/channels.ts`, `common/models/channels.ts`                                                         |
| **NIP-29** | Relay-based Groups  | 9000-9030, 9                     | `common/helpers/groups.ts`, `common/operations/group.ts`, `relay/group.ts`                                        |
| **NIP-51** | Lists               | 10000, 10002, 10003, 10006-10008 | `common/helpers/lists.ts`, `common/helpers/mute.ts`, `common/helpers/bookmark.ts`, `common/helpers/relay-list.ts` |
| **NIP-56** | Reporting           | 1984                             | `common/helpers/reports.ts`, `common/casts/report.ts`                                                             |
| **NIP-65** | Relay List Metadata | 10002                            | `core/factories/mailboxes.ts`, `core/operations/mailboxes.ts`                                                     |
| **NIP-84** | Highlights          | 9802                             | `common/factories/highlight.ts`, `common/operations/highlight.ts`, `common/helpers/highlight.ts`                  |

### Content & Media

| NIP        | Description               | Kinds      | Key Files                                                                                                                                           |
| ---------- | ------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NIP-22** | Comments                  | 1111       | `common/factories/comment.ts`, `common/operations/comment.ts`, `common/helpers/comment.ts`, `common/casts/comment.ts`, `actions/actions/comment.ts` |
| **NIP-23** | Long-form Content         | 30023      | `common/helpers/article.ts` (helpers only, no factory)                                                                                              |
| **NIP-30** | Custom Emoji              | -          | `common/helpers/emoji.ts`, `core/operations/content.ts`                                                                                             |
| **NIP-88** | Polls                     | 1068, 1018 | `common/factories/poll.ts`, `common/factories/poll-response.ts`, `common/helpers/poll.ts`                                                           |
| **NIP-92** | Media Attachments (imeta) | -          | `common/helpers/file-metadata.ts`, `common/operations/media-attachment.ts`                                                                          |
| **NIP-94** | File Metadata             | 1063       | `common/helpers/file-metadata.ts`, `common/operations/file-metadata.ts`                                                                             |
| **NIP-B7** | Blossom Server Lists      | 10063      | `common/helpers/blossom.ts`, `common/operations/blossom.ts`, `actions/blossom.ts`                                                                   |
| **NIP-C0** | Code Snippets             | 1337       | `common/helpers/code-snippet.ts`, `common/casts/code-snippet.ts`                                                                                    |

### Wallet & Payments

| NIP        | Description          | Kinds               | Key Files                                                                                           |
| ---------- | -------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| **NIP-47** | Wallet Connect       | 13194, 23194, 23195 | `wallet-connect/wallet-connect.ts`, `wallet-connect/wallet-service.ts`                              |
| **NIP-57** | Lightning Zaps       | 9735                | `common/helpers/zap.ts`, `common/casts/zap.ts`, `common/models/zaps.ts`, `common/helpers/lnurl.ts`  |
| **NIP-60** | Cashu Wallet         | 7374                | `wallet/helpers/wallet.ts`, `wallet/factories/wallet.ts`, `wallet/casts/wallet.ts`                  |
| **NIP-61** | Nutzaps              | 9321, 10019         | `wallet/helpers/nutzap.ts`, `wallet/actions/nutzaps.ts`, `wallet/casts/nutzap.ts`                   |
| **NIP-75** | Zap Goals            | 9041                | `common/factories/zap-goal.ts`, `common/helpers/zap-goal.ts`, `common/casts/zap-goal.ts`            |
| **NIP-87** | Ecash Mint Discovery | 38172, 38000        | `wallet/helpers/mint-info.ts`, `wallet/helpers/mint-recommendation.ts`, `wallet/casts/mint-info.ts` |

### Advanced Features

| NIP        | Description          | Kinds        | Key Files                                                                                                   |
| ---------- | -------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| **NIP-46** | Remote Signing       | 24133        | `signers/nostr-connect-signer.ts`, `signers/nostr-connect-provider.ts`, `accounts/nostr-connect-account.ts` |
| **NIP-52** | Calendar Events      | 31922, 31923 | `common/factories/calendar.ts`, `common/operations/calendar.ts`, `common/helpers/calendar-event.ts`         |
| **NIP-53** | Live Activities      | 30311, 1311  | `common/helpers/stream.ts`, `common/operations/stream.ts`, `common/casts/stream.ts`                         |
| **NIP-66** | Relay Discovery      | 30166, 10166 | `common/helpers/relay-discovery.ts`, `common/casts/relay-discovery.ts`, `common/casts/relay-monitor.ts`     |
| **NIP-78** | App-specific Data    | 30078        | `common/helpers/app-data.ts`, `common/operations/app-data.ts`, `common/factories/app-data.ts`               |
| **NIP-86** | Relay Management API | -            | `relay/management.ts` (366 lines, all 16 methods)                                                           |
| **NIP-89** | App Handlers         | 31989, 31990 | `common/helpers/app-handler.ts`, `common/operations/client.ts`                                              |
| **NIP-35** | Torrents             | 2003, 2004   | `common/helpers/torrent.ts`, `common/factories/torrent.ts`, `common/casts/torrent.ts`                       |

### Identity & Signers

| NIP        | Description  | Key Files                     |
| ---------- | ------------ | ----------------------------- |
| **NIP-07** | window.nostr | `signers/extension-signer.ts` |

---

## ⚠️ Partially Implemented NIPs (7)

| NIP        | Description          | Status          | Missing Components                                      |
| ---------- | -------------------- | --------------- | ------------------------------------------------------- |
| **NIP-05** | DNS Identifiers      | Parsing only    | No DNS resolution, no `.well-known/nostr.json` fetching |
| **NIP-14** | Subject Tag          | Kind 14 only    | No support for kind 1 notes                             |
| **NIP-23** | Long-form Content    | Helpers only    | No `ArticleFactory` or dedicated operations             |
| **NIP-27** | Text Note References | Partial tagging | Auto "p"/"q" tags but not "e"/"a" tags                  |
| **NIP-28** | Public Chat          | Models only     | No channel event factories                              |
| **NIP-44** | Encrypted Payloads   | Via nostr-tools | No explicit version/base64 handling                     |
| **NIP-57** | Lightning Zaps       | Receipts only   | No zap request creation                                 |
| **NIP-96** | HTTP File Storage    | NIP-94 only     | No kind 10096 or HTTP API                               |

---

## ❌ Not Implemented NIPs (20)

### Critical Gaps

| NIP        | Description           | Kinds           | Priority  |
| ---------- | --------------------- | --------------- | --------- |
| **NIP-06** | Mnemonic Derivation   | -               | 🔴 High   |
| **NIP-13** | Proof of Work         | -               | 🟡 Medium |
| **NIP-58** | Badges                | 8, 30008, 30009 | 🔴 High   |
| **NIP-72** | Moderated Communities | 34550           | 🟡 Medium |
| **NIP-C7** | Chat Messages         | 9               | 🔴 High   |

### Content Types

| NIP        | Description       | Kinds                | Priority |
| ---------- | ----------------- | -------------------- | -------- |
| **NIP-A0** | Voice Messages    | 1222, 1244           | 🟢 Low   |
| **NIP-A4** | Public Messages   | 24                   | 🟢 Low   |
| **NIP-71** | Video Events      | 21, 22, 34234, 34235 | 🟢 Low   |
| **NIP-7D** | Dedicated Threads | 11                   | 🟢 Low   |
| **NIP-54** | Wiki              | 30818                | 🟢 Low   |

### Advanced Features

| NIP        | Description           | Kinds        | Priority  |
| ---------- | --------------------- | ------------ | --------- |
| **NIP-03** | OpenTimestamps        | 1040         | 🟢 Low    |
| **NIP-34** | Git Protocol          | 1617-1633    | 🟡 Medium |
| **NIP-39** | External Identities   | 10011        | 🟢 Low    |
| **NIP-62** | Request to Vanish     | 62           | 🟢 Low    |
| **NIP-64** | Chess                 | 64           | 🟢 Low    |
| **NIP-85** | Trusted Assertions    | 30382-30384  | 🟢 Low    |
| **NIP-90** | Data Vending Machines | 5000-9000    | 🟢 Low    |
| **NIP-99** | Classified Listings   | 30402, 30403 | 🟢 Low    |
| **NIP-B0** | Web Bookmarks         | 39701        | 🟢 Low    |

---

## Package Coverage Summary

| Package            | Primary NIPs                                                                                           | Coverage  |
| ------------------ | ------------------------------------------------------------------------------------------------------ | --------- |
| **core**           | 01, 02, 09, 19, 21, 27, 36, 40, 42, 44, 49, 59, 65, 70, 77, 98                                         | Excellent |
| **common**         | 10, 14, 17, 18, 22, 23, 25, 28, 29, 30, 51, 52, 53, 56, 57, 66, 75, 78, 84, 88, 89, 92, 94, B7, C0, 35 | Excellent |
| **relay**          | 01, 29, 42, 45, 66, 77, 86, 98                                                                         | Excellent |
| **signers**        | 04, 07, 44, 46, 49                                                                                     | Excellent |
| **wallet**         | 47, 57, 60, 61, 87                                                                                     | Excellent |
| **wallet-connect** | 47                                                                                                     | Excellent |
| **actions**        | 02, 09, 17, 18, 51, 56, 59, B7                                                                         | Excellent |
| **content**        | 21, 27, 30, 92                                                                                         | Good      |
| **loaders**        | 02, 25, 57                                                                                             | Good      |
| **accounts**       | 02, 46                                                                                                 | Good      |

---

## Implementation Roadmap

### 🔴 High Priority

1. **NIP-06: Mnemonic Derivation**
   - Add BIP-39/BIP-32 dependencies
   - Create `MnemonicSigner` class
   - Implement `m/44'/1237'/0'/0/n` derivation path

2. **NIP-C7: Chat Messages**
   - Create `ChatMessageFactory` for kind 9
   - Add chat-specific operations
   - Integrate with NIP-29 groups

3. **NIP-58: Badges**
   - Create `BadgeAwardFactory` (kind 8)
   - Create `BadgeDefinitionFactory` (kind 30009)
   - Create `ProfileBadgesFactory` (kind 30008)

### 🟡 Medium Priority

1. **NIP-05: DNS Resolution**

- Add `.well-known/nostr.json` fetching
- Implement pubkey verification

2. **NIP-57: Zap Requests**

- Create `ZapRequestFactory` (kind 9734)
- Add LNURL workflow integration

3. **NIP-96: HTTP File Storage**

- Add kind 10096 server list support
- Create upload/download helpers

4. **NIP-13: Proof of Work**

- Add nonce tag helpers
- Create difficulty calculation utilities
- Add mining utilities

5. **NIP-34: Git Protocol**

- Implement kinds 1617-1633
- Add Git-specific tag helpers

6. **NIP-72: Moderated Communities**

- Create community definition factory (kind 34550)
- Add moderation action support

### 🟢 Low Priority

1. **NIP-23: Article Factory** - Complete long-form content support
2. **NIP-27: Complete Tagging** - Auto "e"/"a" tags for references
3. **NIP-28: Channel Factories** - Complete channel event creation
4. **NIP-44: Version Detection** - Explicit NIP-44 v2 detection
5. **NIP-71: Video Events** - Add video upload/streaming support
6. **NIP-A0: Voice Messages** - Add kind 1222/1244 support
7. **NIP-A4: Public Messages** - Add kind 24 support
8. **NIP-7D: Thread Events** - Add kind 11 support
9. **NIP-54: Wiki** - Add kind 30818 support
10. **NIP-03: OpenTimestamps** - Add OTS attestation support
11. **NIP-39: External Identities** - Add identity provider verification
12. **NIP-62: Request to Vanish** - Add kind 62 support
13. **NIP-64: Chess** - Add kind 64 support
14. **NIP-85: Trusted Assertions** - Add kinds 30382-30384
15. **NIP-90: Data Vending Machines** - Add DVM job support
16. **NIP-99: Classified Listings** - Add kinds 30402/30403
17. **NIP-B0: Web Bookmarks** - Consider adopting kind 39701

---

## Key Findings

### Strengths

1. **Wallet/Payment Ecosystem**: Excellent coverage of NIP-47, 57, 60, 61, 75, 87 with complete factory/cast/helper patterns
2. **Relay Features**: Comprehensive implementation of NIP-01, 42, 45, 66, 77, 86
3. **Content Features**: Strong support for NIP-10, 17, 18, 25, 59, 88, 94
4. **Encryption**: Full NIP-04, 44, 49 support across all signers
5. **Architecture**: Consistent factory → operations → helpers → models pattern

### Gaps

1. **Chat Messaging**: No kind 9 support despite NIP-29 groups
2. **Key Management**: No mnemonic derivation (NIP-06)
3. **Social Features**: Missing badges (NIP-58), communities (NIP-72)
4. **Content Types**: No voice messages (NIP-A0), video (NIP-71), wiki (NIP-54)
5. **Specialized**: No Git (NIP-34), chess (NIP-64), DVM (NIP-90)

---

## Notes

- **NIP-44**: Gift wrap uses `nip44.encrypt()` - verify it's v2, not NIP-04
- **NIP-57**: Zap receipt parsing works but request creation missing
- **NIP-96**: NIP-94 file metadata implemented but no HTTP API
- **NIP-B0**: Custom bookmark system (kinds 10003/30003) instead of 39701
- **NIP-7D**: Uses NIP-10 threading instead of dedicated kind 11
- **NIP-22**: ✅ Full implementation with CommentFactory, casts, operations, and actions
- **NIP-22**: ✅ Full implementation with CommentFactory, casts, operations, and actions

---

## Resources

- [Nostr NIPs Repository](https://github.com/nostr-protocol/nips)
- [Nostr Protocol Documentation](https://github.com/nostr-protocol/nostr)
- [applesauce Documentation](../docs/)
