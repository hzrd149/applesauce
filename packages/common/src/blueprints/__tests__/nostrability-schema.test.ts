import Ajv from "ajv";
import addFormats from "ajv-formats";
import { EventFactory } from "applesauce-core/event-factory";
import { finalizeEvent } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { NoteBlueprint } from "../note.js";
import { ProfileBlueprint } from "../profile.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findRepoRoot(start: string): string {
  let dir = start;
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, "schemata"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("schemata directory not found");
}

const repoRoot = findRepoRoot(__dirname);
const schemasRoot = path.join(repoRoot, "schemata", "nips", "nip-01");

const refBase = "https://nostrability.local/";

function normalizeRef(ref: string) {
  return ref.startsWith("@/") ? `${refBase}${ref.slice(2)}` : ref;
}

function normalizeRefs(schema: any): any {
  // Rewrites nostrability $ref shortcuts so AJV can resolve everything in-memory
  if (Array.isArray(schema)) return schema.map(normalizeRefs);
  if (schema && typeof schema === "object") {
    for (const [key, value] of Object.entries(schema)) {
      if (key === "$ref" && typeof value === "string") {
        schema[key] = normalizeRef(value);
      } else {
        // @ts-expect-error recursive normalization
        schema[key] = normalizeRefs(value);
      }
    }
  }
  return schema;
}

function loadSchema(relativePath: string, id: string) {
  const file = path.join(schemasRoot, relativePath);
  const schema = YAML.parse(fs.readFileSync(file, "utf8"));
  schema.$id = normalizeRef(id);
  return normalizeRefs(schema);
}

function createTestSigner() {
  const sk = generateSecretKey();
  return {
    getPublicKey: async () => getPublicKey(sk),
    signEvent: async (draft: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(draft, sk),
  };
}

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

  const factory = new EventFactory({ signer: createTestSigner() });

  it("produces kind 0 profile events that satisfy nostrability schema", async () => {
    const profileDraft = await factory.create(
      ProfileBlueprint,
      {
        name: "alice",
        display_name: "Alice Doe",
        about: "A test user profile",
        picture: "https://example.com/avatar.png",
        banner: "https://example.com/banner.png",
        website: "https://example.com",
        lud16: "alice@example.com",
        lud06: "LNURL1DP68GURN8GHJ7UM9WFMX2AHXV4KX2APWDAHKCMP0D3H82UNVWQHKCMN4VCC",
        bot: false,
      },
    );
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
