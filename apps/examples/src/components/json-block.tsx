export default function JsonBlock({ value }: { value: any }) {
  return (
    <div className="card bg-base-200 overflow-auto p-4">
      <pre>
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </div>
  );
}
