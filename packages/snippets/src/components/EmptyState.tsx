interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: string;
}

export default function EmptyState({
  title = "No TypeScript snippets found",
  description = "Try selecting a different relay or check back later for new snippets.",
  icon = "📝",
}: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      <div className="text-6xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="opacity-70 max-w-md mx-auto">{description}</p>
    </div>
  );
}
