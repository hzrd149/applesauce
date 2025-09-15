import { EventStore } from "applesauce-core";
import { NostrEvent, fakeVerifyEvent, matchFilter } from "applesauce-core/helpers";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { FilterWithSearch } from "./helpers/sqlite.js";
import { SqliteEventDatabase } from "./sqlite-event-database.js";

// Create the event store with SQLite backend
const database = new SqliteEventDatabase(process.env.DATABASE_PATH || ":memory:");
const eventStore = new EventStore(database);

// Set validation method for event store
eventStore.verifyEvent = fakeVerifyEvent;

// Subscription management
interface Subscription {
  id: string;
  filters: FilterWithSearch[];
  ws: WebSocket;
}

const subscriptions = new Map<string, Subscription>();

// Create HTTP server and WebSocket server
const server = createServer();
const wss = new WebSocketServer({ server });

// Handle WebSocket connections
wss.on("connection", (ws: WebSocket) => {
  console.log("New client connected");

  ws.on("message", async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      if (!Array.isArray(message) || message.length < 2) {
        ws.send(JSON.stringify(["NOTICE", "Invalid message format"]));
        return;
      }

      const [type, ...args] = message;

      switch (type) {
        case "EVENT":
          await handleEvent(ws, args[0]);
          break;

        case "REQ":
          await handleReq(ws, args[0], args.slice(1));
          break;

        case "CLOSE":
          handleClose(ws, args[0]);
          break;

        default:
          ws.send(JSON.stringify(["NOTICE", `Unknown message type: ${type}`]));
      }
    } catch (error) {
      console.error("Error processing message:", error);
      ws.send(JSON.stringify(["NOTICE", "Error processing message"]));
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    // Clean up subscriptions for this WebSocket
    for (const [subId, sub] of subscriptions.entries()) {
      if (sub.ws === ws) {
        subscriptions.delete(subId);
      }
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Handle EVENT messages
async function handleEvent(ws: WebSocket, event: any) {
  try {
    // Basic event validation
    if (typeof event !== "object" || event === null) throw new Error("invalid: event is not valid");

    let added: NostrEvent | null = null;
    try {
      added = eventStore.add(event);
    } catch (error) {
      ws.send(JSON.stringify(["OK", event.id, false, "error: failed to validate event"]));
      return;
    }

    if (!added) {
      ws.send(JSON.stringify(["OK", event.id, false, "error: rejected event"]));
      return;
    }

    if (added === event) {
      // Its a new event because the current instance was returned
      ws.send(JSON.stringify(["OK", event.id, true, ""]));
    } else {
      // It was a duplicate because the "real" instance was returned
      ws.send(JSON.stringify(["OK", event.id, true, "duplicate: event already exists"]));
    }

    // Broadcast to subscribers
    broadcastToSubscribers(event);
  } catch (error) {
    console.error("Error handling event:", error);
    if (error instanceof Error) ws.send(JSON.stringify(["OK", event.id, false, error.message]));
    else ws.send(JSON.stringify(["OK", event.id, false, "error: failed to process event"]));
  }
}

// Handle REQ messages
async function handleReq(ws: WebSocket, subscriptionId: string, filters: FilterWithSearch[]) {
  try {
    // Store subscription
    subscriptions.set(subscriptionId, {
      id: subscriptionId,
      filters,
      ws,
    });

    // Get existing events that match filters
    const events = eventStore.getByFilters(filters);

    // Send matching events
    for (const event of events) {
      ws.send(JSON.stringify(["EVENT", subscriptionId, event]));
    }

    // Send EOSE (End of Stored Events)
    ws.send(JSON.stringify(["EOSE", subscriptionId]));
  } catch (error) {
    console.error("Error handling REQ:", error);
    ws.send(JSON.stringify(["NOTICE", "Error processing subscription"]));
  }
}

// Handle CLOSE messages
function handleClose(ws: WebSocket, subscriptionId: string) {
  const sub = subscriptions.get(subscriptionId);
  if (sub && sub.ws === ws) {
    subscriptions.delete(subscriptionId);
  }
}

// Broadcast event to all subscribers with matching filters
function broadcastToSubscribers(event: NostrEvent) {
  for (const [subId, sub] of subscriptions.entries()) {
    if (sub.ws.readyState === WebSocket.OPEN) {
      // Skip this subscription if it has a search filter (cant match search filters)
      if (sub.filters.some((filter) => filter.search)) continue;

      // Check if event matches any of the subscription filters
      const matches = sub.filters.some((filter) => matchFilter(filter, event));

      if (matches) sub.ws.send(JSON.stringify(["EVENT", subId, event]));
    } else {
      // Clean up closed connections
      subscriptions.delete(subId);
    }
  }
}

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Nostr relay server listening on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});

// Subscribe to new events from the event store to broadcast them
eventStore.insert$.subscribe((event: NostrEvent) => {
  broadcastToSubscribers(event);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down relay server...");
  wss.close(() => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  });
});

console.log("🚀 Nostr relay started!");
console.log("📡 WebSocket endpoint: ws://localhost:" + (process.env.PORT || 8080));
console.log("💾 Database: " + (process.env.DATABASE_PATH || ":memory:"));
console.log("🛑 Press Ctrl+C to stop the server");
