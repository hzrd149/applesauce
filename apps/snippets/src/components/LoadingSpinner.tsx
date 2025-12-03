interface LoadingSpinnerProps {
  message?: string;
}

export default function LoadingSpinner({ message = "Loading snippets..." }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <span className="loading loading-spinner loading-lg mb-4"></span>
      <p className="text-lg opacity-70">{message}</p>
    </div>
  );
}
