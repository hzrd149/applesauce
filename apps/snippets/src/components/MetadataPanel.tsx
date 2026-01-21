import { Controller } from "react-hook-form";
import type {
  Control,
  FieldErrors,
  UseFormHandleSubmit,
  UseFieldArrayAppend,
  UseFieldArrayRemove,
  FieldArrayWithId,
  UseFormSetValue,
} from "react-hook-form";
import AlertMessage from "./AlertMessage";
import SectionHeader from "./SectionHeader";
import TagBadgeList from "./TagBadgeList";
import AddItemForm from "./AddItemForm";
import RelaySection from "./RelaySection";

export interface FieldArrayOperations {
  fields: FieldArrayWithId<any, any, "id">[];
  append: UseFieldArrayAppend<any, any>;
  remove: UseFieldArrayRemove;
}

interface MetadataPanelProps {
  control: Control<any>;
  errors: FieldErrors<any>;
  success: boolean;
  error: string | null;
  noSignerWarning: boolean;
  publishedEventId: string | null;
  isLoggedIn: boolean;
  outboxRelays: string[];
  loadingOutbox: boolean;
  tagFields: FieldArrayOperations;
  depFields: FieldArrayOperations;
  relayFields: FieldArrayOperations;
  setValue: UseFormSetValue<any>;
  onLogin?: () => void;
  handleSubmit: UseFormHandleSubmit<any>;
  onSubmit: (data: any) => void;
}

export default function MetadataPanel({
  control,
  success,
  error,
  noSignerWarning,
  publishedEventId,
  isLoggedIn,
  outboxRelays,
  loadingOutbox,
  tagFields,
  depFields,
  relayFields,
  setValue,
  onLogin,
  handleSubmit,
  onSubmit,
}: MetadataPanelProps) {
  return (
    <div className="w-96 bg-base-100 overflow-auto flex-none">
      <div className="p-4 space-y-4">
        {/* Alerts */}
        {success && (
          <AlertMessage
            type="success"
            message="Published!"
            subtitle={publishedEventId ? `${publishedEventId.substring(0, 16)}...` : undefined}
          />
        )}

        {error && <AlertMessage type="error" message={error} />}

        {noSignerWarning && <AlertMessage type="warning" message="Install Alby, nos2x, or Flamingo extension" />}

        {/* Basic Info */}
        <div className="space-y-3">
          <SectionHeader
            title="Basic Info"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
          />

          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <textarea
                {...field}
                placeholder="Description (optional)"
                className="textarea textarea-bordered w-full h-20 resize-none"
              />
            )}
          />

          <Controller
            name="runtime"
            control={control}
            render={({ field }) => (
              <input {...field} type="text" placeholder="Runtime (optional)" className="input input-bordered w-full" />
            )}
          />

          <Controller
            name="license"
            control={control}
            render={({ field }) => (
              <input {...field} type="text" placeholder="License (MIT)" className="input input-bordered w-full" />
            )}
          />
        </div>

        <div className="divider my-2"></div>

        {/* Tags */}
        <div className="space-y-2">
          <SectionHeader
            title="Tags"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
            }
          />

          <TagBadgeList fields={tagFields.fields} onRemove={tagFields.remove} setValue={setValue} fieldName="tags" />

          <AddItemForm placeholder="Add a tag..." onAdd={(value) => tagFields.append({ value })} />
        </div>

        <div className="divider my-2"></div>

        {/* Dependencies */}
        <div className="space-y-2">
          <SectionHeader
            title="Dependencies"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                />
              </svg>
            }
          />

          <TagBadgeList
            fields={depFields.fields}
            onRemove={depFields.remove}
            setValue={setValue}
            fieldName="dependencies"
          />

          <AddItemForm placeholder="Add a dependency..." onAdd={(value) => depFields.append({ value })} />
        </div>

        <div className="divider my-2"></div>

        {/* Outbox Relays */}
        <div className="space-y-2">
          <SectionHeader
            title="Publish To"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
                />
              </svg>
            }
          />

          <RelaySection
            isLoggedIn={isLoggedIn}
            outboxRelays={outboxRelays}
            loadingOutbox={loadingOutbox}
            relayFields={relayFields.fields}
            control={control}
            onLogin={onLogin}
            appendRelay={relayFields.append}
            removeRelay={relayFields.remove}
            handleSubmit={handleSubmit}
            onSubmit={onSubmit}
          />
        </div>
      </div>
    </div>
  );
}
