export function Toast({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-4 border border-rule border-l-4 border-l-stamp bg-paper px-4 py-3 text-sm shadow-md"
    >
      {message}
    </div>
  );
}
