#!/usr/bin/env bun
import { ProfileContent } from "applesauce-core/helpers";
import { onlyEvents, Relay } from "applesauce-relay";
import { NostrEvent } from "nostr-social-graph";
import { insertEventIntoDescendingList } from "nostr-tools/utils";
import {
  BehaviorSubject,
  bufferTime,
  combineLatest,
  defer,
  delay,
  filter,
  identity,
  map,
  Observable,
  of,
  OperatorFunction,
  pipe,
  ReplaySubject,
  scan,
  share,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  take,
  takeWhile,
  tap,
  throttleTime,
  timer,
} from "rxjs";

// Create an applesauce relay instance
const relay = new Relay("wss://relay.damus.io");
relay.keepAlive = 0;

// Create an input stream for requesting profiles
const requestProfile = new Subject<string>();

// Listen for profile requests and batch them to the relay
// This is similar to what createAddressLoader does under the hood
const profiles$ = requestProfile.pipe(
  // Ignore duplicates (disabled because we need to request the same profile multiple times)
  // distinct(),
  // Batch the requests into an array
  bufferTime(1000),
  // Ignore empty buffers
  filter((buff) => buff.length > 0),
  // Send the requests to the relay
  switchMap((pubkeys) =>
    relay.subscription({ kinds: [0], authors: pubkeys }).pipe(
      // Close the subscription as soon as we get an EOSE
      takeWhile((v) => v !== "EOSE"),
      // Only get the events
      onlyEvents(),
    ),
  ),
  // Accumulate the profiles into a directory
  scan(
    (dir, profile) => {
      return {
        // Take existing profiles
        ...dir,
        // Override the profile for this pubkey
        [profile.pubkey]: profile,
      };
    },
    {} as Record<string, NostrEvent>,
  ),
  share({
    // Keep the last value in memory
    connector: () => new ReplaySubject(1),
    // Unsubscribe from upstream after 1 minute when there are no downstream connections
    resetOnRefCountZero: () => timer(60_000),
  }),
);

// Create a method that will request a profile and return an observable that emits the profile event
function userProfileEvent(pubkey: string): Observable<NostrEvent | undefined> {
  // Defer wont run until there is a subscription
  return defer(() => {
    // IMPORTANT: subscriptions are created immediately, so we need to wait for them to be created before injecting the pubkey
    // Inject the pubkey into the requestProfile stream after the subscriptions are created
    setTimeout(() => requestProfile.next(pubkey), 1);

    return profiles$.pipe(map((profiles) => profiles[pubkey]));
  });
}

// An observable that can be updated from the outside
const pubkey$ = new BehaviorSubject<string | null>(null);

// Create an observable that emits when pubkeys is defined
const pubkeyDefined$ = pubkey$.pipe(
  // Only emit when the pubkey is not null
  filter((p) => p !== null),
  // Log when the pubkey is set
  tap((p) => console.log("pubkey set", p)),
  // Only create a single upstream subscription and keep the last value
  shareReplay(1),
);

// Create a operator that maps kind 3 event to an array of pubkeys
function readContacts(max?: number): OperatorFunction<NostrEvent, string[]> {
  return pipe(
    map((e) =>
      e.tags
        // lok for p tags
        .filter((t) => t[0] === "p")
        // get the pubkey
        .map((t) => t[1]),
    ),
    // if max is set slice the array
    max ? map((arr) => arr.slice(0, max)) : identity,
  );
}

const contacts$ = pubkeyDefined$
  .pipe(
    // Only update every 1 second
    throttleTime(1000),
  )
  .pipe(
    // Create a new subscription for each pubkey and close the last subscription
    // if we used mergeMap we would keep accumulating subscriptions
    // if we use concatMap then new subscriptions would not start until the previous one completes (maybe never?)
    switchMap((pubkey) => {
      // Create a new observable for a relay subscription
      // switchMap will subscribe to this for each pubkey
      return relay.subscription({ kinds: [3], authors: [pubkey] }).pipe(
        // Close the subscription as soon as we get an EOSE
        takeWhile((v) => v !== "EOSE"),
        // Don't emit "EOSE" because we dont need it after this point
        filter((v) => typeof v !== "string"),
        // only get the first event
        take(1),
        // get the contacts pubkey's
        readContacts(100),
      );
    }),
    // Log the pubkeys we get
    // tap((v) => console.log("contacts", v)),
    // Only create a single upstream subscription and keep the last value
    shareReplay(1),
  );

// Create an observable that emits notes by contacts that mention the user
const mentions$ = combineLatest([pubkeyDefined$, contacts$]).pipe(
  switchMap(([pubkey, contacts]) => {
    // Create a subscription for the kind 1 events
    return relay
      .subscription({
        // Short text notes
        kinds: [1],
        // Events from the contacts
        authors: contacts,
        // Events tagging the user
        "#p": [pubkey],
        // Ask for three as many events as we need
        limit: 30,
      })
      .pipe(
        // only get the events (same as filter((v) => typeof v !== "string"))
        onlyEvents(),
        // Ignore events from the user
        filter((event) => event.pubkey !== pubkey),
        // Close subscription after 10 events
        take(10),
        // map the stream of events into a timeline (for every value add it to the array)
        scan((acc, event) => insertEventIntoDescendingList(acc, event), [] as NostrEvent[]),
      );
  }),
  // Only create a single upstream subscription and keep the last value
  shareReplay(1),
);

// Listen for contacts
contacts$.subscribe((v) => console.log("contacts", v));

// Start the whole stream
const sub = mentions$
  .pipe(
    // Only get the first 10 events for rendering
    map((timeline) => timeline.slice(0, 10)),
    // Each time the timeline changes, get the profiles for each event
    switchMap((timeline) => {
      return combineLatest(
        // Map over the 10 events in the timeline and convert them to an observable that gets their profiles
        // NOTE: this is advanced, your better off using this in react components
        timeline.map((event) =>
          // this will return an observable of {event: NostrEvent, profile: NostrEvent | undefined}
          combineLatest({
            // Keep the event object of(event) returns an observable that completes immediately with the value
            event: of(event),
            // Request the profile event and wait for it
            profile: userProfileEvent(event.pubkey).pipe(
              // Ignore undefined profiles
              filter((e) => e !== undefined),
              // Randomly delay the profile loading so we can see it loading
              delay(Math.random() * 5000),
              // When we get the profile event, parse the content
              map((profileEvent) => (profileEvent ? (JSON.parse(profileEvent.content) as ProfileContent) : undefined)),
              // Immeidently emit undefined so the UI renders
              startWith(undefined),
            ),
          }),
        ),
      );
    }),
  )
  .subscribe((eventPair) => {
    // render mentions to console
    console.clear();

    // render all events
    for (const { event, profile } of eventPair) {
      console.log(profile?.name || profile?.display_name || "...Loading profile please wait...");
      console.log(event.content.slice(0, 256));
      console.log("--------------------------------");
    }
  });

// Finally set the users pubkey
setTimeout(() => {
  pubkey$.next("266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5");

  // change pubkey after 3s
  setTimeout(() => {
    pubkey$.next("0d6c8388dcb049b8dd4fc8d3d8c3bb93de3da90ba828e4f09c8ad0f346488a33");
  }, 30_000);
}, 1000);

// Close after 5 seconds
setTimeout(() => {
  sub.unsubscribe();
}, 60_000);
