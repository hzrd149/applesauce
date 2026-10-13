/**
 * Browse NIP-52 events in a calendar with month, week, three-day, and day views
 * @tags nip-52, calendar, timeline, events
 * @related calendar/map
 */
import {
  CALENDAR_EVENT_RSVP_KIND,
  COMMENT_KIND,
  getRSVPStatus,
  getRSVPFreeBusy,
  DATE_BASED_CALENDAR_EVENT_KIND,
  getCalendarEventEnd,
  getCalendarEventImage,
  getCalendarEventLocations,
  getCalendarEventParticipants,
  getCalendarEventStart,
  getCalendarEventSummary,
  getCalendarEventTitle,
  TIME_BASED_CALENDAR_EVENT_KIND,
} from "applesauce-common/helpers";
import { CalendarEventRSVPsModel, MailboxesModel } from "applesauce-common/models";
import { EventStore } from "applesauce-core";
import {
  getDisplayName,
  getSeenRelays,
  getTagValue,
  getReplaceableAddress,
  isSafeRelayURL,
  relaySet,
  NostrEvent,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ChevronLeft, ChevronRight, MapPin, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();
const kinds = [DATE_BASED_CALENDAR_EVENT_KIND, TIME_BASED_CALENDAR_EVENT_KIND];
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

const months = Array.from({ length: 12 }, (_, month) =>
  new Date(2024, month, 1).toLocaleDateString(undefined, { month: "long" }),
);
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type CalendarView = "day" | "3day" | "week" | "month";
const viewLabels = { day: "Day", "3day": "3 day", week: "Week", month: "Month" };
type CalendarEntry = { event: NostrEvent; start: Date; end: Date; allDay: boolean };

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function weekStart(date: Date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

// Date-only tags have no timezone; parsing them as UTC would shift them in the calendar.
function parseDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return dayKey(date) === value ? date : undefined;
}

function calendarEntry(event: NostrEvent): CalendarEntry | undefined {
  const allDay = event.kind === DATE_BASED_CALENDAR_EVENT_KIND;
  const start = allDay
    ? parseDate(getTagValue(event, "start"))
    : new Date((getCalendarEventStart(event) ?? NaN) * 1000);
  if (!start || !Number.isFinite(start.getTime())) return undefined;
  const end = allDay ? parseDate(getTagValue(event, "end")) : new Date((getCalendarEventEnd(event) ?? NaN) * 1000);
  return {
    event,
    start,
    // NIP-52 end dates/times are exclusive. Missing timed ends are instantaneous.
    end: end && Number.isFinite(end.getTime()) && end > start ? end : allDay ? addDays(start, 1) : start,
    allDay,
  };
}

function occursOn(entry: CalendarEntry, date: Date) {
  const next = addDays(date, 1);
  return (
    entry.start < next && (entry.end > date || (entry.end.getTime() === entry.start.getTime() && entry.start >= date))
  );
}

function timeLabel(entry: CalendarEntry) {
  return entry.allDay ? "All day" : entry.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function AuthorName({ event }: { event: NostrEvent }) {
  const profile = use$(
    () => eventStore.profile({ pubkey: event.pubkey, relays: [...(getSeenRelays(event) ?? [])] }),
    [event.id],
  );
  return <span>{getDisplayName(profile, event.pubkey.slice(0, 12))}</span>;
}

function EventDetails({ entry, relay, onClose }: { entry: CalendarEntry; relay: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const original = entry.event;
  const identifier = getTagValue(original, "d") ?? "";
  const latest = use$(
    () => eventStore.replaceable({ kind: original.kind, pubkey: original.pubkey, identifier }),
    [original.id],
  );
  const event = latest ?? original;
  const current = calendarEntry(event) ?? entry;
  const { start, end, allDay } = current;
  const address = getReplaceableAddress(event)!;
  const hints = useMemo(
    () =>
      relaySet(
        [relay],
        [...(getSeenRelays(original) ?? [])],
        original.tags.filter((t) => t[0] === "r" && isSafeRelayURL(t[1])).map((t) => t[1]),
      ),
    [original.id, relay],
  );
  const mailboxes = use$(
    () => eventStore.model(MailboxesModel, { pubkey: original.pubkey, relays: hints }),
    [original.id, hints.join("|")],
  );
  const relays = relaySet(hints, mailboxes?.outboxes).filter(isSafeRelayURL);
  const [pending, setPending] = useState<string[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const rsvps = use$(() => eventStore.model(CalendarEventRSVPsModel, event), [event.id]);
  const comments = use$(
    () =>
      eventStore.timeline([
        { kinds: [COMMENT_KIND], "#A": [address] },
        { kinds: [COMMENT_KIND], "#E": [event.id] },
        { kinds: [COMMENT_KIND, 1], "#a": [address] },
        { kinds: [COMMENT_KIND, 1], "#e": [event.id] },
      ]),
    [event.id, address],
  );

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    setPending(relays);
    setFailures([]);
    // Opening the modal discovers outboxes and fetches the latest revision and its related events.
    const subscriptions = relays.map((url) =>
      pool
        .relay(url)
        .subscription([
          { kinds: [event.kind], authors: [event.pubkey], "#d": [identifier] },
          { kinds: [CALENDAR_EVENT_RSVP_KIND, COMMENT_KIND, 1], "#a": [address] },
          { kinds: [COMMENT_KIND], "#A": [address] },
          { kinds: [CALENDAR_EVENT_RSVP_KIND, COMMENT_KIND, 1], "#e": [event.id] },
          { kinds: [COMMENT_KIND], "#E": [event.id] },
        ])
        .subscribe({
          next: (message) => {
            if (message === "EOSE") setPending((values) => values.filter((value) => value !== url));
            else eventStore.add(message);
          },
          error: (error: unknown) => {
            setPending((values) => values.filter((value) => value !== url));
            setFailures((values) => [...values, `${url}: ${error instanceof Error ? error.message : String(error)}`]);
          },
          complete: () => setPending((values) => values.filter((value) => value !== url)),
        }),
    );
    return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
  }, [relays.join("|"), event.id, address, identifier]);

  const participants = getCalendarEventParticipants(event);
  const image = getCalendarEventImage(event);
  const format = (date: Date) => (allDay ? date.toLocaleDateString() : date.toLocaleString());
  // One current response per attendee; RSVPs pinned to older revisions are shown separately.
  const attendees = new Map<string, NostrEvent>();
  for (const rsvp of rsvps ?? []) if (!attendees.has(rsvp.pubkey)) attendees.set(rsvp.pubkey, rsvp);
  const responses = [...attendees.values()];

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          event.currentTarget.close();
      }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-3xl max-h-[90dvh] rounded border border-base-300 bg-base-100 text-base-content p-0 backdrop:bg-black/50"
      aria-labelledby="calendar-event-title"
    >
      <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-base-300 bg-base-100 p-5 z-10">
        <h2 id="calendar-event-title" className="text-xl font-semibold break-words">
          {getCalendarEventTitle(event) || "Untitled event"}
        </h2>
        <button
          className="btn btn-ghost btn-sm btn-square shrink-0"
          onClick={() => dialog.current?.close()}
          aria-label="Close event details"
        >
          <X size={18} />
        </button>
      </div>
      <div className="p-5 space-y-5">
        {image && <img src={image} alt="" className="max-h-64 w-full object-cover rounded" />}
        <p>
          {format(start)}
          {end > start && ` – ${format(allDay ? addDays(end, -1) : end)}`}
          {allDay && " · All day"}
        </p>
        <p className="text-sm text-base-content/60">
          Hosted by <AuthorName event={event} />
        </p>
        {getCalendarEventLocations(event).map((location, i) => (
          <p key={i} className="flex items-start gap-2 text-sm break-all">
            <MapPin size={16} className="shrink-0 mt-0.5" />
            {location}
          </p>
        ))}
        <p className="whitespace-pre-wrap break-words">
          {event.content || getCalendarEventSummary(event) || "No description provided."}
        </p>
        {participants.length > 0 && (
          <section className="border-t border-base-300 pt-4">
            <h3 className="font-semibold mb-2">Participants</h3>
            {participants.map((participant, index) => (
              <p key={index} className="text-sm break-all">
                {participant.pubkey.slice(0, 16)}
                {participant.role && ` · ${participant.role}`}
              </p>
            ))}
          </section>
        )}
        <section className="border-t border-base-300 pt-4 space-y-3">
          <h3 className="font-semibold">RSVPs ({responses.length})</h3>
          <p className="text-sm text-base-content/60">
            {["accepted", "tentative", "declined"]
              .map(
                (status) =>
                  `${responses.filter((response) => getRSVPStatus(response) === status && (!getTagValue(response, "e") || getTagValue(response, "e") === event.id)).length} ${status}`,
              )
              .join(" · ")}
          </p>
          {responses.length === 0 && (
            <p className="text-sm text-base-content/50">
              {pending.length ? "Loading RSVPs…" : "No RSVPs found on these relays."}
            </p>
          )}
          {responses.map((response) => (
            <div key={response.id} className="border-l-2 border-base-300 pl-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <AuthorName event={response} />
                <span className="capitalize">
                  {getRSVPStatus(response) ?? "Unknown status"}
                  {getRSVPFreeBusy(response) && ` · ${getRSVPFreeBusy(response)}`}
                </span>
              </div>
              {getTagValue(response, "e") && getTagValue(response, "e") !== event.id && (
                <p className="text-xs text-warning">Response to an earlier event revision</p>
              )}
              {response.content && <p className="whitespace-pre-wrap mt-1">{response.content}</p>}
            </div>
          ))}
        </section>
        <section className="border-t border-base-300 pt-4 space-y-3">
          <h3 className="font-semibold">Comments ({comments?.length ?? 0})</h3>
          {!comments?.length && (
            <p className="text-sm text-base-content/50">
              {pending.length ? "Loading comments…" : "No comments found on these relays."}
            </p>
          )}
          {comments?.map((comment) => (
            <article key={comment.id} className="border-l-2 border-base-300 pl-3">
              <div className="text-sm flex flex-wrap justify-between gap-2">
                <AuthorName event={comment} />
                <time className="text-xs text-base-content/50">
                  {new Date(comment.created_at * 1000).toLocaleString()}
                </time>
              </div>
              <p className="whitespace-pre-wrap break-words mt-1">{comment.content}</p>
            </article>
          ))}
        </section>
        <p role="status" className="text-xs text-base-content/50">
          {pending.length
            ? `Loading from ${pending.length} relays…`
            : "Related events are live while this window is open."}
        </p>
        {failures.map((failure, i) => (
          <p key={i} className="text-xs text-warning break-all">
            {failure}
          </p>
        ))}
      </div>
    </dialog>
  );
}

function viewDays(selection: CalendarView, selectedDate: Date, month: Date) {
  if (selection !== "month")
    return Array.from({ length: selection === "day" ? 1 : selection === "3day" ? 3 : 7 }, (_, i) =>
      addDays(selection === "week" ? weekStart(selectedDate) : selectedDate, i),
    );
  const start = weekStart(month);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const count =
    Math.round(
      (Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
        86400000,
    ) + 1;
  return Array.from({ length: Math.ceil(count / 7) * 7 }, (_, i) => addDays(start, i));
}

function timedLayout(entries: CalendarEntry[], day: Date) {
  const items = entries
    .filter((entry) => !entry.allDay && occursOn(entry, day))
    .map((entry) => {
      const start = entry.start < day ? 0 : entry.start.getHours() * 60 + entry.start.getMinutes();
      const end = entry.end >= addDays(day, 1) ? 1440 : entry.end.getHours() * 60 + entry.end.getMinutes();
      return { entry, start, end: Math.min(1440, Math.max(start + 30, end)), lane: 0, columns: 1 };
    })
    .sort((a, b) => a.start - b.start);
  let group: typeof items = [];
  let lanes: number[] = [];
  let groupEnd = 0;
  const finishGroup = () =>
    group.forEach((item) => {
      item.columns = lanes.length;
    });
  for (const item of items) {
    if (item.start >= groupEnd) {
      finishGroup();
      group = [];
      lanes = [];
    }
    let lane = lanes.findIndex((end) => end <= item.start);
    if (lane < 0) lane = lanes.length;
    item.lane = lane;
    lanes[lane] = item.end;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  finishGroup();
  return items;
}

function TimeCalendar({
  days,
  entries,
  selectedId,
  onSelect,
  onDay,
}: {
  days: Date[];
  entries: CalendarEntry[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDay: (day: Date) => void;
}) {
  const columns = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <div className="flex flex-1 flex-col min-w-0 overflow-x-auto">
      <div style={{ minWidth: days.length * 110 + 56 }} className="flex flex-1 flex-col">
        <div className="grid border-b border-base-300" style={{ gridTemplateColumns: columns }}>
          <span />
          {days.map((day) => (
            <button key={dayKey(day)} className="py-3 text-sm hover:bg-base-200" onClick={() => onDay(day)}>
              {day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </button>
          ))}
        </div>
        <div className="grid border-b border-base-300" style={{ gridTemplateColumns: columns }}>
          <span className="text-xs text-base-content/50 p-2">All day</span>
          {days.map((day) => (
            <div key={dayKey(day)} className="border-l border-base-300 p-1 space-y-1 min-h-12">
              {entries
                .filter((entry) => entry.allDay && occursOn(entry, day))
                .map((entry) => (
                  <button
                    key={entry.event.id}
                    className="block w-full rounded bg-primary/15 text-primary p-1 text-xs text-left truncate"
                    onClick={() => onSelect(entry.event.id)}
                  >
                    {getCalendarEventTitle(entry.event) || "Untitled event"}
                  </button>
                ))}
            </div>
          ))}
        </div>
        <div className="overflow-y-auto max-h-[70dvh] flex-1">
          <div className="grid" style={{ gridTemplateColumns: columns }}>
            <div>
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} className="h-12 pr-2 text-right text-xs text-base-content/50 border-t border-base-300">
                  {String(hour).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {days.map((day) => {
              const positioned = timedLayout(entries, day);
              return (
                <div key={dayKey(day)} className="relative border-l border-base-300 h-[1152px]">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <div key={hour} className="h-12 border-t border-base-300" />
                  ))}
                  {positioned.map(({ entry, start, end, lane, columns }) => (
                    <button
                      key={entry.event.id}
                      className={`absolute overflow-hidden rounded border-l-2 border-primary p-1 text-left text-xs hover:bg-primary/30 ${selectedId === entry.event.id ? "bg-primary/30" : "bg-base-200"}`}
                      style={{
                        top: start * 0.8,
                        height: (end - start) * 0.8,
                        left: `${(lane * 100) / columns}%`,
                        width: `${100 / columns}%`,
                      }}
                      onClick={() => onSelect(entry.event.id)}
                      title={getCalendarEventTitle(entry.event)}
                    >
                      <span className="block text-base-content/60">
                        {entry.start < day ? "Continued" : timeLabel(entry)}
                      </span>
                      <span className="font-medium">{getCalendarEventTitle(entry.event) || "Untitled event"}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CalendarTimeline() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => addDays(new Date(), 0));
  const [selection, setSelection] = useState<CalendarView>("month");
  const [yearInput, setYearInput] = useState(() => String(new Date().getFullYear()));
  const [selectedId, setSelectedId] = useState<string>();
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "closed">("loading");
  const [error, setError] = useState<string>();

  useEffect(() => setYearInput(String(month.getFullYear())), [month]);

  useEffect(() => {
    setEvents([]);
    setSelectedId(undefined);
    setStatus("loading");
    setError(undefined);
    const latest = new Map<string, NostrEvent>();
    // Event creation dates differ from calendar dates, so fetch both kinds without a since/until filter.
    const subscription = pool
      .relay(relay)
      .subscription({ kinds })
      .subscribe({
        next: (message) => {
          if (message === "EOSE") setStatus("live");
          else {
            const event = message;
            eventStore.add(event);
            const key = `${event.kind}:${event.pubkey}:${getTagValue(event, "d") ?? event.id}`;
            const previous = latest.get(key);
            if (
              !previous ||
              event.created_at > previous.created_at ||
              (event.created_at === previous.created_at && event.id < previous.id)
            ) {
              latest.set(key, event);
              setEvents([...latest.values()]);
            }
          }
        },
        error: (err: unknown) => {
          setStatus("closed");
          setError(err instanceof Error ? err.message : String(err));
        },
        complete: () => setStatus("closed"),
      });
    return () => subscription.unsubscribe();
  }, [relay]);

  const entries = useMemo(
    () =>
      events
        .map(calendarEntry)
        .filter((entry): entry is CalendarEntry => !!entry)
        .sort(
          (a, b) =>
            Number(b.allDay) - Number(a.allDay) ||
            a.start.getTime() - b.start.getTime() ||
            a.event.id.localeCompare(b.event.id),
        ),
    [events],
  );
  const days = useMemo(() => viewDays(selection, selectedDate, month), [selection, selectedDate, month]);
  const byDay = useMemo(
    () => new Map(days.map((day) => [dayKey(day), entries.filter((entry) => occursOn(entry, day))])),
    [days, entries],
  );
  const agendaDays = selection === "month" ? [selectedDate] : days;
  const active = entries.find((entry) => entry.event.id === selectedId);
  const today = dayKey(new Date());
  const monthCount = entries.filter(
    (entry) =>
      entry.start < new Date(month.getFullYear(), month.getMonth() + 1, 1) &&
      (entry.end > month || entry.start >= month),
  ).length;

  function selectDate(date: Date, mode = selection) {
    setSelectedDate(date);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setSelection(mode);
    setSelectedId(undefined);
  }

  function changeMonth(year: number, index: number) {
    const next = new Date(year, index, 1);
    if (next.getFullYear() < 100 || next.getFullYear() > 9999) return;
    setMonth(next);
    selectDate(
      new Date(
        next.getFullYear(),
        next.getMonth(),
        Math.min(selectedDate.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()),
      ),
    );
  }

  function navigate(direction: number) {
    if (selection === "month") changeMonth(month.getFullYear(), month.getMonth() + direction);
    else {
      const next = addDays(selectedDate, direction * (selection === "day" ? 1 : selection === "3day" ? 3 : 7));
      if (next.getFullYear() >= 100 && next.getFullYear() <= 9999) selectDate(next);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 w-full min-w-0 p-3 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-ghost btn-square btn-sm"
          aria-label={`Previous ${viewLabels[selection].toLowerCase()}`}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={20} />
        </button>
        <select
          aria-label="Month"
          className="select select-sm w-auto"
          value={month.getMonth()}
          onChange={(e) => changeMonth(month.getFullYear(), Number(e.target.value))}
        >
          {months.map((name, index) => (
            <option key={name} value={index}>
              {name}
            </option>
          ))}
        </select>
        <input
          aria-label="Year"
          type="number"
          min={100}
          max={9999}
          className="input input-sm w-24"
          value={yearInput}
          onChange={(e) => setYearInput(e.target.value)}
          onBlur={() => {
            const year = Number(yearInput);
            if (Number.isInteger(year) && year >= 100 && year <= 9999) changeMonth(year, month.getMonth());
            else setYearInput(String(month.getFullYear()));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <button
          className="btn btn-ghost btn-square btn-sm"
          aria-label={`Next ${viewLabels[selection].toLowerCase()}`}
          onClick={() => navigate(1)}
        >
          <ChevronRight size={20} />
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            const now = new Date();
            setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            selectDate(addDays(now, 0));
          }}
        >
          Today
        </button>
        <div className="flex-1" />
        <RelayPicker value={relay} onChange={setRelay} className="w-full sm:w-80" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-base-content/60" role="status">
          {status === "loading"
            ? "Loading events…"
            : `${monthCount} events this month · ${status === "live" ? "Live" : "Disconnected"}`}{" "}
          · Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
        <div className="join" aria-label="Calendar view">
          {(["day", "3day", "week", "month"] as const).map((mode) => (
            <button
              key={mode}
              className={`btn btn-sm join-item ${selection === mode ? "btn-primary" : "btn-ghost"}`}
              aria-pressed={selection === mode}
              onClick={() => selectDate(selectedDate, mode)}
            >
              {viewLabels[mode]}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="border border-error/40 p-3 text-sm text-error">
          {error} Choose another relay to load events.
        </p>
      )}
      <div className="grid flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem] border border-base-300 rounded overflow-hidden">
        <section
          className="flex min-w-0 flex-col"
          aria-label={month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        >
          {selection !== "month" ? (
            <TimeCalendar
              days={days}
              entries={entries}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDay={(date) => selectDate(date, "day")}
            />
          ) : (
            <div className="flex flex-1 flex-col overflow-x-auto">
              <div className="flex flex-1 flex-col min-w-[560px]">
                <div className="grid shrink-0 grid-cols-[2rem_repeat(7,minmax(0,1fr))] border-b border-base-300 bg-base-200/40">
                  <span className="sr-only">Select week</span>
                  <span aria-hidden="true" />
                  {weekdays.map((day) => (
                    <div key={day} className="py-3 text-center text-xs font-medium text-base-content/60">
                      {day}
                    </div>
                  ))}
                </div>
                {Array.from({ length: days.length / 7 }, (_, row) => {
                  const week = days.slice(row * 7, row * 7 + 7);
                  return (
                    <div
                      key={dayKey(week[0])}
                      className="grid flex-1 grid-cols-[2rem_repeat(7,minmax(0,1fr))] border-b last:border-b-0 border-base-300"
                    >
                      <button
                        className={`border-r border-base-300 text-xs hover:bg-base-200 text-base-content/40`}
                        aria-label={`Select week of ${week[0].toLocaleDateString()}`}

                        onClick={() => selectDate(week[0], "week")}
                      >
                        ›
                      </button>
                      {week.map((date) => {
                        const key = dayKey(date);
                        const dayEvents = byDay.get(key) ?? [];
                        const selected = key === dayKey(selectedDate);
                        return (
                          <div
                            key={key}
                            className={`min-h-32 sm:min-h-36 border-r last:border-r-0 border-base-300 p-1 sm:p-2 ${selected ? "bg-primary/10" : ""} ${date.getMonth() !== month.getMonth() ? "bg-base-200/40 text-base-content/40" : ""}`}
                          >
                            <button
                              className="w-full text-left mb-1 hover:text-primary"
                              aria-label={`Select ${date.toLocaleDateString(undefined, { dateStyle: "full" })}, ${dayEvents.length} events`}
                              aria-pressed={selected}
                              onClick={() => selectDate(date, "day")}
                            >
                              <span
                                className={`inline-flex items-center justify-center size-7 rounded-full text-sm ${key === today ? "bg-primary text-primary-content font-semibold" : ""}`}
                              >
                                {date.getDate()}
                              </span>
                            </button>
                            <div className="space-y-1">
                              {dayEvents.slice(0, 3).map((entry) => (
                                <button
                                  key={entry.event.id}
                                  className={`block w-full truncate rounded px-1.5 py-1 text-left text-xs hover:bg-primary/20 ${entry.allDay ? "bg-primary/15 text-primary" : "bg-base-200"}`}
                                  title={`${timeLabel(entry)} · ${getCalendarEventTitle(entry.event) || "Untitled event"}`}
                                  onClick={() => {
                                    selectDate(date);
                                    setSelectedId(entry.event.id);
                                  }}
                                >
                                  <span className="mr-1 opacity-60">{entry.allDay ? "•" : timeLabel(entry)}</span>
                                  {getCalendarEventTitle(entry.event) || "Untitled event"}
                                </button>
                              ))}
                              {dayEvents.length > 3 && (
                                <button className="text-xs text-primary px-1" onClick={() => selectDate(date, "day")}>
                                  +{dayEvents.length - 3} more
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
        <aside className="border-t xl:border-t-0 xl:border-l border-base-300 min-w-0">
          <div className="p-4 border-b border-base-300">
            <h2 className="font-semibold">
              {agendaDays.length === 1
                ? selectedDate.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })
                : `${agendaDays[0].toLocaleDateString()} – ${agendaDays[agendaDays.length - 1].toLocaleDateString()}`}
            </h2>
          </div>
          <div className="max-h-[36rem] overflow-y-auto p-4 space-y-5">
            {agendaDays.map((date) => {
              const items = entries.filter((entry) => occursOn(entry, date));
              return (
                <section key={dayKey(date)}>
                  {agendaDays.length > 1 && (
                    <h3 className="text-xs font-semibold text-base-content/60 mb-2">
                      {date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                    </h3>
                  )}
                  {items.length === 0 ? (
                    <p className="text-sm text-base-content/40">
                      {status === "loading" ? "Waiting for events…" : "No events scheduled."}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {items.map((entry) => (
                        <li key={entry.event.id}>
                          <button
                            className={`w-full text-left p-2 border-l-2 hover:bg-base-200 ${selectedId === entry.event.id ? "border-primary bg-primary/10" : "border-base-300"}`}
                            aria-pressed={selectedId === entry.event.id}
                            onClick={() => setSelectedId(entry.event.id)}
                          >
                            <span className="block text-xs text-base-content/60">
                              {timeLabel(entry)}
                              {!entry.allDay && entry.start < date && " · Continued"}
                            </span>
                            <span className="block text-sm font-medium break-words">
                              {getCalendarEventTitle(entry.event) || "Untitled event"}
                            </span>
                            {getCalendarEventLocations(entry.event)[0] && (
                              <span className="block text-xs text-base-content/50 truncate mt-1">
                                {getCalendarEventLocations(entry.event)[0]}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </aside>
      </div>
      {active && (
        <EventDetails key={active.event.id} entry={active} relay={relay} onClose={() => setSelectedId(undefined)} />
      )}
    </div>
  );
}
