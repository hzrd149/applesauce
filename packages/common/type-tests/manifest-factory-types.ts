import { expectTypeOf } from "vitest";
import { NostrEvent } from "applesauce-core/helpers";
import {
  RootNsiteFactory,
  NamedNsiteFactory,
  NsiteSnapshotFactory,
  RootNappletFactory,
  NamedNappletFactory,
  NappletSnapshotFactory,
} from "../src/factories/index.js";

declare const event: NostrEvent;
const hash = "a".repeat(64);
const files = [{ path: "/index.html", sha256: hash }];

const rootNsiteFactory = RootNsiteFactory.create(files).file("/about.html", hash).title("Root");
expectTypeOf(rootNsiteFactory).toEqualTypeOf<RootNsiteFactory>();
expectTypeOf<Awaited<typeof rootNsiteFactory>["kind"]>().toEqualTypeOf<15128>();
expectTypeOf<Awaited<ReturnType<typeof rootNsiteFactory.sign>>["kind"]>().toEqualTypeOf<15128>();
expectTypeOf(RootNsiteFactory.modify(event).file("/about.html", hash).title("Root")).toEqualTypeOf<RootNsiteFactory>();
// @ts-expect-error Only named manifests have an identifier builder
rootNsiteFactory.identifier("other");

const namedNsiteFactory = NamedNsiteFactory.create("blog", files).title("Blog").identifier("other");
expectTypeOf(namedNsiteFactory).toEqualTypeOf<NamedNsiteFactory>();
expectTypeOf<Awaited<typeof namedNsiteFactory>["kind"]>().toEqualTypeOf<35128>();
expectTypeOf<Awaited<ReturnType<typeof namedNsiteFactory.sign>>["kind"]>().toEqualTypeOf<35128>();
expectTypeOf(NamedNsiteFactory.modify(event).title("Blog").identifier("other")).toEqualTypeOf<NamedNsiteFactory>();

const nsiteSnapshotFactory = NsiteSnapshotFactory.create(event).file("/about.html", hash).title("Snapshot");
expectTypeOf(nsiteSnapshotFactory).toEqualTypeOf<NsiteSnapshotFactory>();
expectTypeOf<Awaited<typeof nsiteSnapshotFactory>["kind"]>().toEqualTypeOf<5128>();
expectTypeOf<Awaited<ReturnType<typeof nsiteSnapshotFactory.sign>>["kind"]>().toEqualTypeOf<5128>();
expectTypeOf(
  NsiteSnapshotFactory.modify(event).file("/about.html", hash).title("Snapshot"),
).toEqualTypeOf<NsiteSnapshotFactory>();
// @ts-expect-error Only named manifests have an identifier builder
nsiteSnapshotFactory.identifier("other");

const rootNappletFactory = RootNappletFactory.create(hash, "Root").artifact(hash).title("Root");
expectTypeOf(rootNappletFactory).toEqualTypeOf<RootNappletFactory>();
expectTypeOf<Awaited<typeof rootNappletFactory>["kind"]>().toEqualTypeOf<15129>();
expectTypeOf<Awaited<ReturnType<typeof rootNappletFactory.sign>>["kind"]>().toEqualTypeOf<15129>();
expectTypeOf(RootNappletFactory.modify(event).artifact(hash).title("Root")).toEqualTypeOf<RootNappletFactory>();
// @ts-expect-error Only named manifests have an identifier builder
rootNappletFactory.identifier("other");

const namedNappletFactory = NamedNappletFactory.create("feed", hash, "Feed").title("Feed").identifier("other");
expectTypeOf(namedNappletFactory).toEqualTypeOf<NamedNappletFactory>();
expectTypeOf<Awaited<typeof namedNappletFactory>["kind"]>().toEqualTypeOf<35129>();
expectTypeOf<Awaited<ReturnType<typeof namedNappletFactory.sign>>["kind"]>().toEqualTypeOf<35129>();
expectTypeOf(NamedNappletFactory.modify(event).title("Feed").identifier("other")).toEqualTypeOf<NamedNappletFactory>();

const nappletSnapshotFactory = NappletSnapshotFactory.create(event).artifact(hash).title("Snapshot");
expectTypeOf(nappletSnapshotFactory).toEqualTypeOf<NappletSnapshotFactory>();
expectTypeOf<Awaited<typeof nappletSnapshotFactory>["kind"]>().toEqualTypeOf<5129>();
expectTypeOf<Awaited<ReturnType<typeof nappletSnapshotFactory.sign>>["kind"]>().toEqualTypeOf<5129>();
expectTypeOf(
  NappletSnapshotFactory.modify(event).artifact(hash).title("Snapshot"),
).toEqualTypeOf<NappletSnapshotFactory>();
// @ts-expect-error Only named manifests have an identifier builder
nappletSnapshotFactory.identifier("other");

expectTypeOf(RootNsiteFactory.copy(event).title("Copy")).toEqualTypeOf<RootNsiteFactory>();
expectTypeOf(NamedNsiteFactory.copy(event, "copy").identifier("other")).toEqualTypeOf<NamedNsiteFactory>();
// @ts-expect-error Named copies require an identifier
NamedNsiteFactory.copy(event);
