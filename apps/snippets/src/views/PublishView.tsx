import { EventFactory, blueprint, defined } from "applesauce-core";
import { setContent } from "applesauce-core/operations/content";
import { includeNameValueTag, includeSingletonTag } from "applesauce-core/operations/tags";
import { use$ } from "applesauce-react/hooks";
import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { firstValueFrom } from "rxjs";
import { AccountDisplay, CodeEditorPanel, MetadataPanel, type FieldArrayOperations } from "../components";
import { CODE_SNIPPET_KIND } from "../helpers/nostr";
import { accounts } from "../services/accounts";
import { eventStore } from "../services/event-store";
import { pool } from "../services/pool";

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
  onNavigateToSignin: () => void;
}

export default function PublishView({ onBack, onPublishSuccess, onNavigateToSignin }: PublishViewProps) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [noSignerWarning, setNoSignerWarning] = useState(false);
  const [publishedEventId, setPublishedEventId] = useState<string | null>(null);
  const [outboxRelays, setOutboxRelays] = useState<string[]>([]);
  const [loadingOutbox, setLoadingOutbox] = useState(false);

  // Get active account from accounts service
  const activeAccount = use$(() => accounts.active$, []);

  // Derive state from active account
  const isLoggedIn = !!activeAccount;

  // Create factory with active account's signer
  const factory = useMemo(() => {
    if (!activeAccount) return null;
    return new EventFactory({ signer: activeAccount });
  }, [activeAccount]);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CodeSnippetFormData>({
    defaultValues: {
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

  // Fetch outbox relays when account changes
  useEffect(() => {
    if (!activeAccount?.pubkey) {
      setOutboxRelays([]);
      return;
    }

    const fetchOutboxRelays = async () => {
      try {
        setLoadingOutbox(true);
        const mailboxes = await firstValueFrom(eventStore.mailboxes(activeAccount.pubkey).pipe(defined()));

        if (mailboxes?.outboxes?.length) {
          setOutboxRelays(mailboxes.outboxes);
        } else {
          setOutboxRelays([]);
        }
      } catch (err) {
        console.warn("Could not fetch outbox relays:", err);
        setOutboxRelays([]);
      } finally {
        setLoadingOutbox(false);
      }
    };

    fetchOutboxRelays();
  }, [activeAccount?.pubkey]);

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

      if (!isLoggedIn || !activeAccount || !factory) {
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
      <div className="navbar bg-base-100 border-b border-base-300 flex-none">
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
          <AccountDisplay onNavigateToSignin={onNavigateToSignin} />
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
          handleSubmit={handleSubmit}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}
