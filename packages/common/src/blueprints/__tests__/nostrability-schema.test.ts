import Ajv from "ajv";
import addFormats from "ajv-formats";
import { EventFactory } from "applesauce-core/event-factory";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { loadSchema } from "../../__tests__/schemata.js";
import { NoteBlueprint } from "../note.js";
import { ProfileBlueprint } from "../profile.js";

const user = new FakeUser();
const factory = new EventFactory({ signer: user });

describe("nostrability schemas", () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  // Load schemas from the local nostrability copy to ensure CI catches upstream changes.
  const secp256k1Schema = loadSchema("secp256k1/schema.yaml", "@/secp256k1.yaml");
  const tagSchema = loadSchema("tag/schema.yaml", "@/tag.yaml");
  const noteSchema = loadSchema("note/schema.yaml", "@/note.yaml");
  const kind0Schema = loadSchema("kind-0/schema.yaml", "@/kind-0/schema.yaml");
  const kind0ContentSchema = loadSchema("kind-0/schema.content.yaml", "@/kind-0/schema.content.yaml");
  const kind1Schema = loadSchema("kind-1/schema.yaml", "@/kind-1/schema.yaml");

  ajv.addSchema(secp256k1Schema);
  ajv.addSchema(tagSchema);
  ajv.addSchema(noteSchema);

  const validateKind0 = ajv.compile(kind0Schema);
  const validateKind0Content = ajv.compile(kind0ContentSchema);
  const validateKind1 = ajv.compile(kind1Schema);

  it("produces kind 0 profile events that satisfy nostrability schema", async () => {
    const profileDraft = await factory.create(ProfileBlueprint, {
      name: "alice",
      display_name: "Alice Doe",
      about: "A test user profile",
      picture: "https://example.com/avatar.png",
      banner: "https://example.com/banner.png",
      website: "https://example.com",
      lud16: "alice@example.com",
      lud06: "LNURL1DP68GURN8GHJ7UM9WFMX2AHXV4KX2APWDAHKCMP0D3H82UNVWQHKCMN4VCC",
      bot: false,
    });
    const profileEvent = await factory.sign(profileDraft);

    const eventValid = validateKind0(profileEvent);
    expect(eventValid).toBe(true);
    const content = JSON.parse(profileEvent.content);
    const contentValid = validateKind0Content(content);
    expect(contentValid).toBe(true);
  });

  it("produces kind 1 note events that satisfy nostrability schema", async () => {
    const noteDraft = await factory.create(NoteBlueprint, "hello nostrability");
    const noteEvent = await factory.sign(noteDraft);

    const eventValid = validateKind1(noteEvent);
    expect(eventValid).toBe(true);
  });
});
