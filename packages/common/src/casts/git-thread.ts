import { ChainableObservable } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { castEventStream, castTimelineStream } from "applesauce-core/observable/cast-stream";
import { combineLatest, defer, from, map, Observable, of, switchMap } from "rxjs";
import {
  getGitRepositoryMaintainers,
  getGitRepositoryReference,
  GitRepositoryPointer,
} from "../helpers/git-repository.js";
import { GitStatus } from "../helpers/git-status.js";
import { GitStatusEventModel, GitStatusModel, GitThreadCommentsModel } from "../models/git.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { Comment } from "./comment.js";
import type { GitRepository } from "./git-repository.js";

// GitRepository imports the thread casts, so it MUST be imported lazily to avoid a circular dependency
const GitRepositoryModule = defer(() => from(import("./git-repository.js")));

/** Base cast for NIP-34 issues, patches and pull requests */
export class GitThread<T extends NostrEvent = NostrEvent> extends EventCast<T> {
  /** Creates a shared repository thread cast */
  constructor(event: T, store: CastRefEventStore) {
    super(event, store);
  }

  /** The pointer to the repository this thread belongs to */
  get repositoryPointer(): GitRepositoryPointer {
    return getGitRepositoryReference(this.event)!;
  }

  /** The `<kind>:<pubkey>:<identifier>` address of the repository */
  get repositoryAddress(): string {
    const { kind, pubkey, identifier } = this.repositoryPointer;
    return `${kind}:${pubkey}:${identifier}`;
  }

  /** The title of the thread, falls back to the first line of the content */
  get title(): string {
    return this.event.content.split("\n", 1)[0].trim();
  }

  /** Subscribes to the repository announcement */
  get repository$(): ChainableObservable<GitRepository | undefined> {
    return this.$$ref("repository$", (store) =>
      GitRepositoryModule.pipe(
        switchMap(({ GitRepository }) =>
          store.replaceable(this.repositoryPointer).pipe(castEventStream(GitRepository, store)),
        ),
      ),
    );
  }

  /** Subscribes to the pubkeys allowed to set the status, the repository owner is used until the announcement loads */
  get maintainers$(): ChainableObservable<string[]> {
    return this.$$ref("maintainers$", (store) =>
      store
        .replaceable(this.repositoryPointer)
        .pipe(map((repo) => (repo ? getGitRepositoryMaintainers(repo) : [this.repositoryPointer.pubkey]))),
    );
  }

  /** Subscribes to the current status */
  get status$(): ChainableObservable<GitStatus> {
    return this.$$ref("status$", (store) =>
      this.maintainers$.pipe(switchMap((maintainers) => store.model(GitStatusModel, this.event, maintainers))),
    );
  }

  /** Subscribes to the latest authorized status event */
  get statusEvent$(): ChainableObservable<NostrEvent | undefined> {
    return this.$$ref("statusEvent$", (store) =>
      this.maintainers$.pipe(switchMap((maintainers) => store.model(GitStatusEventModel, this.event, maintainers))),
    );
  }

  /** Subscribes to all NIP-22 comments in the thread */
  get comments$(): ChainableObservable<Comment[]> {
    return this.$$ref("comments$", (store) =>
      store.model(GitThreadCommentsModel, this.event).pipe(castTimelineStream(Comment, store)),
    );
  }

  /** Extra events that count as activity on the thread */
  protected activity$(): Observable<NostrEvent[]> {
    return of([]);
  }

  /** Subscribes to the unix timestamp of the most recent activity (status, comment or update) */
  get updatedAt$(): ChainableObservable<number> {
    return this.$$ref("updatedAt$", (store) =>
      combineLatest([this.statusEvent$, store.model(GitThreadCommentsModel, this.event), this.activity$()]).pipe(
        map(([status, comments, activity]) => {
          let latest = Math.max(this.event.created_at, status?.created_at ?? 0);
          for (const event of comments) latest = Math.max(latest, event.created_at);
          for (const event of activity) latest = Math.max(latest, event.created_at);
          return latest;
        }),
      ),
    );
  }
}
