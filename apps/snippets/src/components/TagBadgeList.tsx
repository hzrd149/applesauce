import type { FieldArrayWithId } from "react-hook-form";

interface TagBadgeListProps {
  fields: FieldArrayWithId<any, any, "id">[];
  onRemove: (index: number) => void;
  setValue: (name: string, value: string) => void;
  fieldName: string;
}

export default function TagBadgeList({ fields, onRemove, setValue, fieldName }: TagBadgeListProps) {
  if (!fields.length || !fields.some((f: any) => f.value)) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {fields.map((field: any, index: number) => {
        const value = field.value;
        if (!value) return null;
        return (
          <div key={field.id} className="badge badge-lg gap-2">
            {value}
            <button
              type="button"
              onClick={() => {
                setValue(`${fieldName}.${index}.value`, "");
                onRemove(index);
              }}
              className="btn btn-ghost btn-xs btn-circle"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
