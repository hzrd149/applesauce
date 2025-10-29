import { useState } from "react";

interface AddItemFormProps {
  placeholder: string;
  onAdd: (value: string) => void;
  buttonText?: string;
}

export default function AddItemForm({ placeholder, onAdd, buttonText = "Add" }: AddItemFormProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onAdd(value.trim());
      setValue("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="input input-bordered input-sm flex-1"
      />
      <button type="submit" className="btn btn-sm btn-primary" disabled={!value.trim()}>
        {buttonText}
      </button>
    </form>
  );
}
