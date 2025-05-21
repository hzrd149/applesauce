import { EventStore, mapEventsToStore } from "applesauce-core";
import { eventPointerLoader } from "applesauce-loaders";
import { ComponentMap, useObservable, useRenderedContent } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { NostrEvent } from "nostr-tools";
import { decode, EventPointer } from "nostr-tools/nip19";
import { useMemo, useState } from "react";
import { merge } from "rxjs";
import { RelayPicker } from "../components/relay-picker";

// Create stores and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();

// Create components for rendering content
const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => (
    <a href={node.href} target="_blank" className="text-blue-500 hover:underline">
      {node.value}
    </a>
  ),
  mention: ({ node }) => (
    <span className="text-purple-500">
      @{node.encoded.slice(0, 10)}...{node.encoded.slice(-5)}
    </span>
  ),
  hashtag: ({ node }) => <span className="text-orange-500">#{node.hashtag}</span>,
  emoji: ({ node }) => (
    <span className="text-green-500">
      <img title={node.raw} src={node.url} className="w-6 h-6 inline" /> {node.raw}
    </span>
  ),
  cashu: ({ node }) => (
    <span className="text-pink-500">
      @{node.raw.slice(0, 10)}...{node.raw.slice(-5)}
    </span>
  ),
  lightning: ({ node }) => (
    <span className="text-yellow-400">
      {node.invoice.slice(0, 10)}...{node.invoice.slice(-5)}
    </span>
  ),
};

const eventLoader = eventPointerLoader(pool.request.bind(pool), {
  eventStore,
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
});

const examples: EventPointer[] = [
  "nevent1qvzqqqqqqypzqxh4f92ex6lgqnu4qyry06j6mfw8vfldmurnfflczwa6pcc7aktqqy2hwumn8ghj7mn0wd68ytn00p68ytnyv4mz7qg4waehxw309aex2mrp0yhxgctdw4eju6t09uqzq5uj68wa0cgqwak43wtalf35ypclethsmmmrnn7u926fwwpy9fw58geyf6",
  "nevent1qqsfhafvv705g5wt8rcaytkj6shsshw3dwgamgfe3za8knk0uq4yesgpzpmhxue69uhkummnw3ezuamfdejszrthwden5te0dehhxtnvdakqsrnltk",
  "nevent1qvzqqqqqqypzp22rfmsktmgpk2rtan7zwu00zuzax5maq5dnsu5g3xxvqr2u3pd7qyghwumn8ghj7mn0wd68ytnhd9hx2tcpzamhxue69uhhyetvv9ujumn0wd68ytnzv9hxgtcqyqtplwkqnp05239mvxmpewhtkhtq3fvljp7kqlxduzvz9pqryhtacxpum48",
  "nevent1qvzqqqqqqypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqyd8wumn8ghj7mr0vd4kymmc9enxjct5dfskvtnrdakj7qg4waehxw309aex2mrp0yhxgctdw4eju6t09uqzp3s3dg4pxlncurwnslqxxxskq7z8ys3j8wfr9m5s9ufspka3jfc3tq9y28",
  "nevent1qvzqqqqqqypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqyd8wumn8ghj7mr0vd4kymmc9enxjct5dfskvtnrdakj7qg4waehxw309aex2mrp0yhxgctdw4eju6t09uqzpawhd8gw3pzl4t923uc5r5wvpd3z6p3argdwz45g0dwd38meqf7k887dps",
  "nevent1qvzqqqqqqypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqyd8wumn8ghj7mr0vd4kymmc9enxjct5dfskvtnrdakj7qg4waehxw309aex2mrp0yhxgctdw4eju6t09uqzpxyres0r4mtyv2jw37fxp2rcc7jqgjagjl7sww5wsmphf5z53az5c0dnzm",
  "nevent1qvzqqqqqqypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqyd8wumn8ghj7mr0vd4kymmc9enxjct5dfskvtnrdakj7qpqu35ew3sp89shfd22ujzuc05jmazgrjzx545f63nt8vc49zltgzsqcx9h9t",
  "nevent1qvzqqqqqqypzqaqc0waan5czxr9ltuxjpavwpq8lp38huc9va7ynrvcgjwd8hdtsqy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qgwwaehxw309ahx7uewd3hkctcqypd2ejn8dykjp03r0zcwll979v7qyj25ku8hpyxr36ydakjey4dr65pnxfg",
  "nevent1qvzqqqqqqypzpl0ejdgzyg0rrnvvzcmhyytd5xcefa4rntw4ss6nqd54j3c7ad40qqsqmemkxzgs74w4xt3xlghanaj24hjlpeda2xajzyc4ruxrehk0j7sed8ztc",
  "nevent1qvzqqqqqqypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qyf8wumn8ghj7mn0wd68yat99e3k7mf0qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qpqd29yg6e5y0uyq0ttva728agcjzhxffgnz8a5kqwfrf5njk68yxmqp4mwth",
  "nevent1qvzqqqqqqypzp22rfmsktmgpk2rtan7zwu00zuzax5maq5dnsu5g3xxvqr2u3pd7qyghwumn8ghj7mn0wd68ytnhd9hx2tcpzamhxue69uhhyetvv9ujumn0wd68ytnzv9hxgtcqyznatxwe42lsqutcjafw2v72dtxh0v2w0327m5yh4w3kgwzp0mkx7edh4e6",
  "nevent1qvzqqqqqqypzp978pfzrv6n9xhq5tvenl9e74pklmskh4xw6vxxyp3j8qkke3cezqy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qgwwaehxw309ahx7uewd3hkctcqyzzw77p395ld4zgamuswcd9rj452hewfdmaqp5nynedakztl96h57r9u6r3",
  "nevent1qvzqqqqqqypzp022u0n8u2vkf4y5zu3xrhz989wgna4a9em5vshrvcf8zuwlhq04qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qghwaehxw309aex2mrp0yh8qunfd4skctnwv46z7qpq9dn29mvp39q48fawujfxrnrhjtsm3wf4y0nvdjdwea4h9ykxzxpsamhr4l",
  "nevent1qvzqqqqqqypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qyf8wumn8ghj7mn0wd68yat99e3k7mf0qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qpqw9tjg79fycymqv9ppzksk6fmafpw9tzlsy7sqckvxd5ggqpy49as5x0yxh",
].map((nevent) => decode(nevent.replace(/^nostr:/, "")).data as EventPointer);

function EventCard({ event }: { event: NostrEvent }) {
  const content = useRenderedContent(event, components);

  return (
    <div key={event.id} className="p-4 bg-base-200 rounded-lg overflow-hidden whitespace-pre-wrap">
      <div className="mb-2 text-sm text-base-content/70">Event: {event.id.substring(0, 8)}...</div>
      {content}
    </div>
  );
}

export default function ContentRenderingExample() {
  const [relay, setRelay] = useState<string>("");

  const loader = useMemo(() => merge(...examples.map(eventLoader)), []);
  useObservable(loader);

  const fromRelay$ = useMemo(
    () =>
      relay
        ? pool
            .relay(relay)
            .subscription({
              kinds: [1],
              limit: 20,
            })
            .pipe(onlyEvents(), mapEventsToStore(eventStore))
        : undefined,
    [relay],
  );
  useObservable(fromRelay$);

  const timeline$ = useMemo(() => eventStore.timeline({ kinds: [1] }), []);
  const events = useObservable(timeline$);

  return (
    <div className="container mx-auto p-4">
      <div className="flex gap-2 justify-between">
        <h1 className="text-2xl font-bold mb-4">Content Rendering</h1>
        <RelayPicker value={relay} onChange={setRelay} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {events?.map((event) => <EventCard key={event.id} event={event} />)}
      </div>
    </div>
  );
}
