import { defined } from "applesauce-core";
import { EventFactory, blueprint } from "applesauce-factory";
import { setContent } from "applesauce-factory/operations/content";
import { includeNameValueTag, includeSingletonTag } from "applesauce-factory/operations/tags";
import { ExtensionSigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import { useEffect, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { firstValueFrom } from "rxjs";

import { CodeEditorPanel, MetadataPanel, type FieldArrayOperations } from "../components";
import { CODE_SNIPPET_KIND, eventStore, pool } from "../helpers/nostr";

// Setup signer and factory
const signer = new ExtensionSigner();
const factory = new EventFactory({ signer });

// Language to extension mapping
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  ruby: "rb",
  php: "php",
  swift: "swift",
  kotlin: "kt",
};

// Form data types
type CodeSnippetFormData = {
  title?: string;
  name: string;
  description: string;
  code: string;
  language: string;
  extension: string;
  runtime?: string;
  license?: string;
  tags: { value: string }[];
  dependencies: { value: string }[];
  relays: { value: string }[];
};

// Blueprint for creating code snippet events following NIP-C0
function CodeSnippetBlueprint(data: CodeSnippetFormData) {
  const operations = [
    setContent(data.code),
    // Required tags per NIP-C0
    includeSingletonTag(["l", data.language]),
    includeSingletonTag(["name", data.name]),
    includeSingletonTag(["extension", data.extension]),
    // Optional tags per NIP-C0
    data.description && data.description.trim() ? includeSingletonTag(["description", data.description]) : undefined,
    data.runtime && data.runtime.trim() ? includeSingletonTag(["runtime", data.runtime]) : undefined,
    data.license && data.license.trim() ? includeSingletonTag(["license", data.license]) : undefined,
    // Add topic tags (t tags - not in NIP-C0 spec but commonly used)
    ...data.tags.filter((tag) => tag.value.trim()).map((tag) => includeNameValueTag(["t", tag.value.trim()], false)),
    // Add dependencies (dep tags per NIP-C0)
    ...data.dependencies
      .filter((dep) => dep.value.trim())
      .map((dep) => includeNameValueTag(["dep", dep.value.trim()], false)),
  ];

  return blueprint(CODE_SNIPPET_KIND, ...operations.filter(Boolean));
}

interface PublishViewProps {
  onBack: () => void;
  onPublishSuccess?: (eventId: string) => void;
}

export default function PublishView({ onBack, onPublishSuccess }: PublishViewProps) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [noSignerWarning, setNoSignerWarning] = useState(false);
  const [publishedEventId, setPublishedEventId] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [outboxRelays, setOutboxRelays] = useState<string[]>([]);
  const [loadingOutbox, setLoadingOutbox] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CodeSnippetFormData>({
    defaultValues: {
      title: "",
      name: "",
      description: "",
      code: "",
      language: "typescript",
      extension: "ts",
      runtime: "",
      license: "",
      tags: [{ value: "" }],
      dependencies: [{ value: "" }],
      relays: [{ value: "" }],
    },
  });

  // Watch for changes to language and filename
  const watchedLanguage = useWatch({ control, name: "language" });
  const watchedFilename = useWatch({ control, name: "name" });

  // Auto-update extension based on language or filename
  useEffect(() => {
    // First check if filename has an extension
    if (watchedFilename && watchedFilename.includes(".")) {
      const filenameParts = watchedFilename.split(".");
      const filenameExt = filenameParts[filenameParts.length - 1];
      if (filenameExt && filenameExt.length <= 4) {
        setValue("extension", filenameExt);
        return;
      }
    }

    // Otherwise, use language-based extension
    if (watchedLanguage && LANGUAGE_EXTENSIONS[watchedLanguage]) {
      setValue("extension", LANGUAGE_EXTENSIONS[watchedLanguage]);
    }
  }, [watchedLanguage, watchedFilename, setValue]);

  // Login and fetch outbox relays
  const handleLogin = async () => {
    try {
      setLoadingOutbox(true);
      setError(null);

      // Check for window.nostr signer
      if (typeof window === "undefined" || !(window as any).nostr) {
        setNoSignerWarning(true);
        setError("No Nostr extension found. Please install a Nostr browser extension like Alby or nos2x.");
        setLoadingOutbox(false);
        return;
      }

      const userPubkey = await signer.getPublicKey();
      setPubkey(userPubkey);
      setIsLoggedIn(true);

      // Fetch outbox relays
      try {
        const mailboxes = await firstValueFrom(eventStore.mailboxes(userPubkey).pipe(defined()));

        if (mailboxes?.outboxes?.length) {
          setOutboxRelays(mailboxes.outboxes);
        } else {
          setOutboxRelays([]);
        }
      } catch (err) {
        console.warn("Could not fetch outbox relays:", err);
        setOutboxRelays([]);
      }
    } catch (err) {
      console.error("Login failed:", err);
      setError(err instanceof Error ? err.message : "Failed to login");
    } finally {
      setLoadingOutbox(false);
    }
  };

  useEffect(() => {
    // Auto-login on mount
    handleLogin();
  }, []);

  const {
    fields: tagFields,
    append: appendTag,
    remove: removeTag,
  } = useFieldArray({
    control,
    name: "tags",
  });

  const {
    fields: depFields,
    append: appendDep,
    remove: removeDep,
  } = useFieldArray({
    control,
    name: "dependencies",
  });

  const {
    fields: relayFields,
    append: appendRelay,
    remove: removeRelay,
  } = useFieldArray({
    control,
    name: "relays",
  });

  const onSubmit = async (data: CodeSnippetFormData) => {
    try {
      setPublishing(true);
      setError(null);
      setNoSignerWarning(false);
      setSuccess(false);

      // Validate required fields
      if (!data.name.trim()) {
        setError("Filename is required");
        return;
      }

      if (!data.code.trim()) {
        setError("Code content is required");
        return;
      }

      if (!isLoggedIn) {
        setError("Please login first");
        return;
      }

      // Use outbox relays or fallback to manual relays
      let relayUrls: string[] = [...outboxRelays];

      // If no outbox relays, use manually provided relays
      if (relayUrls.length === 0) {
        const validRelays = data.relays.filter((relay) => relay.value.trim());
        if (validRelays.length === 0) {
          setError(
            "No outbox relays found. Please specify at least one relay or add outbox relays to your profile (NIP-65).",
          );
          return;
        }
        relayUrls = validRelays.map((relay) => relay.value.trim());
      }

      // Create and sign the event
      const event = await factory.create(CodeSnippetBlueprint, data);
      const signed = await factory.sign(event);

      // Publish to relays
      await pool.publish(relayUrls, signed);

      setSuccess(true);
      setPublishedEventId(signed.id);

      // Redirect to the published snippet after a short delay
      setTimeout(() => {
        if (onPublishSuccess) {
          onPublishSuccess(signed.id);
        }
      }, 1500);
    } catch (err) {
      console.error("Failed to publish code snippet:", err);
      setError(err instanceof Error ? err.message : "Failed to publish code snippet");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-300 flex flex-col">
      {/* Header */}
      <div className="navbar bg-base-100 shadow-sm border-b border-base-300 flex-none">
        <div className="flex-1">
          <button onClick={onBack} className="btn btn-ghost">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="ml-4 font-semibold">Publish Code Snippet</span>
        </div>
        <div className="flex-none gap-2">
          {isLoggedIn && pubkey ? (
            <div className="flex items-center gap-2">
              <span className="opacity-70">{nip19.npubEncode(pubkey).substring(0, 12)}...</span>
              <div className="badge badge-success">Connected</div>
            </div>
          ) : (
            <button onClick={handleLogin} className="btn btn-primary" disabled={loadingOutbox}>
              {loadingOutbox ? "Connecting..." : "Login"}
            </button>
          )}
        </div>
      </div>

      {/* Main Content - Split Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side - Code Editor */}
        <CodeEditorPanel
          control={control}
          errors={errors}
          publishing={publishing}
          isLoggedIn={isLoggedIn}
          onSubmit={handleSubmit(onSubmit)}
        />

        {/* Right Side - Metadata & Settings */}
        <MetadataPanel
          control={control}
          errors={errors}
          success={success}
          error={error}
          noSignerWarning={noSignerWarning}
          publishedEventId={publishedEventId}
          isLoggedIn={isLoggedIn}
          outboxRelays={outboxRelays}
          loadingOutbox={loadingOutbox}
          tagFields={
            {
              fields: tagFields,
              append: appendTag,
              remove: removeTag,
            } as FieldArrayOperations
          }
          depFields={
            {
              fields: depFields,
              append: appendDep,
              remove: removeDep,
            } as FieldArrayOperations
          }
          relayFields={
            {
              fields: relayFields,
              append: appendRelay,
              remove: removeRelay,
            } as FieldArrayOperations
          }
          setValue={setValue}
          onLogin={handleLogin}
          handleSubmit={handleSubmit}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}
