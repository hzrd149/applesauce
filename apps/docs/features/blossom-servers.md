---
description: Read and edit the list of Blossom media servers a user uploads to
---

# Blossom Servers

Blossom servers store media files by their sha256 hash. Users publish an ordered list of the servers they upload to (kind 10063), with the first server as their default. Apps use it to pick upload targets and to find a user's files when a URL stops working.

## Reading a user's servers

`user.blossomServers$` loads the user's server list from their outboxes and returns the servers in order as root `URL`s.

```ts
const servers = use$(user.blossomServers$); // URL[] | undefined
const uploadTo = servers?.[0] ?? new URL("https://blossom.example.com");
```

**Example:** [Blossom Server Manager](https://applesauce.build/examples/#/example/blossom/server-manager)

## Subscribing without casts

`eventStore.blossomServers()` returns the same `URL[]` for a pubkey or `ProfilePointer`. It is a shortcut for `UserBlossomServersModel` and is added by `applesauce-common`, so import that package before calling it.

```ts
eventStore.blossomServers(pubkey).subscribe((servers) => console.log(servers?.map((s) => s.href)));
```

## Editing the server list

The blossom actions update the current user's server list and publish it to their outboxes, creating the list if it's missing. `AddBlossomServer` and `RemoveBlossomServer` take one server or an array.

```ts
await actions.run(AddBlossomServer, "https://cdn.example.com");
await actions.run(RemoveBlossomServer, ["https://old.example.com"]);
await actions.run(SetDefaultBlossomServer, "https://cdn.example.com"); // moves it to the top
```

`NewBlossomServers(servers?)` creates the list and throws if one already exists.

## Building server list events

`BlossomServerListFactory` from `applesauce-common/factories` builds the event directly. `servers()` replaces the whole list in order.

```ts
const signed = await BlossomServerListFactory.create().servers([primary, backup]).sign(signer);
const updated = await BlossomServerListFactory.modify(event).addServer(url).setDefaultServer(url).sign(signer);
```

## Helpers

Helpers in `applesauce-common/helpers` handle server URLs:

- `getBlossomServersFromList(event)` returns the ordered servers from a list event or tag array
- `mergeBlossomServers(...lists)` merges servers into one array without duplicates, keeping the first occurrence's order
- `normalizeBlossomServer(url)` returns a server's root URL, adding `https://` when missing
- `areBlossomServersEqual(a, b)` compares two servers by their root URL

```ts
const targets = mergeBlossomServers(servers, appDefaults);
```

## Best Practices

- Treat the first server as the user's default upload target
- Upload to more than one server so files survive one going down
- Merge the user's servers with app defaults using `mergeBlossomServers` instead of concatenating arrays
- Compare servers with `areBlossomServersEqual`, since the same server can be written with or without a trailing slash
