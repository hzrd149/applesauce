import { Controller } from "react-hook-form";
import type { Control, FieldErrors } from "react-hook-form";

interface CodeEditorPanelProps {
  control: Control<any>;
  errors: FieldErrors<any>;
  publishing: boolean;
  isLoggedIn: boolean;
  onSubmit: () => void;
}

export default function CodeEditorPanel({ control, errors, publishing, isLoggedIn, onSubmit }: CodeEditorPanelProps) {
  return (
    <div className="flex-1 flex flex-col bg-base-200 border-r border-base-300 overflow-auto">
      <form onSubmit={onSubmit} className="flex-1 flex flex-col">
        {/* Editor Header */}
        <div className="p-3 bg-base-100 border-b border-base-300 flex gap-2 items-center">
          <Controller
            name="name"
            control={control}
            rules={{ required: "Filename is required" }}
            render={({ field }) => (
              <input
                {...field}
                type="text"
                placeholder="filename.ts"
                className={`input input-bordered flex-1 font-mono ${errors.name ? "input-error" : ""}`}
              />
            )}
          />
          <Controller
            name="language"
            control={control}
            rules={{ required: "Language is required" }}
            render={({ field }) => (
              <select {...field} className="select select-bordered font-mono">
                <option value="typescript">TypeScript</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="rust">Rust</option>
                <option value="go">Go</option>
                <option value="java">Java</option>
                <option value="c">C</option>
                <option value="cpp">C++</option>
                <option value="csharp">C#</option>
                <option value="ruby">Ruby</option>
                <option value="php">PHP</option>
                <option value="swift">Swift</option>
                <option value="kotlin">Kotlin</option>
              </select>
            )}
          />
        </div>

        {/* Code Textarea */}
        <div className="flex-1 p-0">
          <Controller
            name="code"
            control={control}
            rules={{ required: "Code content is required" }}
            render={({ field }) => (
              <textarea
                {...field}
                placeholder="// Paste your code here..."
                className={`textarea w-full h-full font-mono resize-none border-0 rounded-none focus:outline-none ${
                  errors.code ? "textarea-error" : ""
                }`}
                style={{ minHeight: "100%" }}
              />
            )}
          />
        </div>

        {/* Bottom Toolbar */}
        <div className="p-3 bg-base-100 border-t border-base-300 flex justify-between items-center">
          <div className="opacity-70">
            {errors.code && <span className="text-error">Code is required</span>}
            {errors.name && <span className="text-error">Filename is required</span>}
          </div>
          <button
            type="submit"
            className={`btn btn-primary ${publishing ? "loading" : ""}`}
            disabled={publishing || !isLoggedIn}
          >
            {publishing ? "Publishing..." : "Publish Snippet"}
          </button>
        </div>
      </form>
    </div>
  );
}
