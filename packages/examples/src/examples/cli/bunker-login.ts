import { defined, EventStore, firstValueFrom, simpleTimeout } from "applesauce-core";
import { EventFactory } from "applesauce-factory";
import { createAddressLoader, createEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import { npubEncode } from "nostr-tools/nip19";
import * as qrcodeTerminal from "qrcode-terminal";
import { getTerminalInterface } from "../../cli/terminal-interface";

async function qrcode(uri: string): Promise<string> {
  return new Promise((resolve) => {
    qrcodeTerminal.generate(uri, { small: true }, (qrcode) => resolve(qrcode));
  });
}

const pool = new RelayPool();

// Create event store and loaders for handling events
const eventStore = new EventStore();

const eventLoader = createEventLoader(pool, { eventStore });
const addressLoader = createAddressLoader(pool, { eventStore });

// Attach loaders to event store
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;
eventStore.eventLoader = eventLoader;

// Setup nostr connect signer
NostrConnectSigner.pool = pool;

export default async function CliBunkerLoginExample() {
  const term = getTerminalInterface();

  term.write("Welcome to the cli example for bunker login");
  term.write("Please choose a login method:");
  term.write("- bunker (1) - Login with a bunker URI");
  term.write("- qrcode (2) - Login with a QR code");
  term.write("- exit (e) - Exit the program");

  const method = await term.prompt("Choose login method: (bunker or qrcode): ");
  let signer: NostrConnectSigner;

  switch (method) {
    case "bunker":
    case "2": {
      const bunkerUri = await term.prompt("Please enter the bunker URI: ");
      signer = await NostrConnectSigner.fromBunkerURI(bunkerUri);

      const pubkey = await signer.getPublicKey();
      term.write(`Signer connected: ${npubEncode(pubkey)}\n`);
      break;
    }

    default:
    case "qr":
    case "1": {
      // Make signer wait for remote signer
      signer = new NostrConnectSigner({
        relays: ["wss://relay.nsec.app"],
      });

      const uri = signer.getNostrConnectURI({
        name: "Applesauce Example",
      });

      // Print the QR code to the terminal
      term.write(`Scan the following QR code to login:`);
      term.write(await qrcode(uri));
      term.write(uri);

      // Wait for remove signer to connect
      await signer.waitForSigner();

      const pubkey = await signer.getPublicKey();
      term.write(`Signer connected: ${npubEncode(pubkey)}\n`);
      break;
    }

    case "e":
    case "exit":
      return term.exit();
  }

  // Create a new event factory for creating events
  const factory = new EventFactory({ signer });

  while (true) {
    term.write("- pubkey - Show your public key");
    term.write("- note - Publish a note");
    term.write("- exit - Exit the program");
    const command = await term.prompt("Enter a command: ");

    switch (command) {
      case "pubkey": {
        const pubkey = await signer.getPublicKey();
        term.write(`Public key: ${npubEncode(pubkey)}\n`);
        break;
      }
      case "note": {
        const pubkey = await signer.getPublicKey();
        const note = await term.prompt("Publish a note: ");
        const event = await factory.note(note);
        const signed = await factory.sign(event);

        const mailboxes = await firstValueFrom(eventStore.mailboxes(pubkey).pipe(defined(), simpleTimeout(5_000)));

        if (!mailboxes?.outboxes?.length) {
          term.write(`No outboxes found, please add an outbox relay to your profile`);
          break;
        }

        term.write(`Publishing event to ${mailboxes?.outboxes?.length} outboxes`);
        await pool.publish(mailboxes.outboxes, signed);
        term.write(`Event published ${signed.id}`);
        break;
      }
      case "exit":
        return term.exit();
    }
  }
}

// Tell the example app this is a terminal example
CliBunkerLoginExample.terminal = true;
