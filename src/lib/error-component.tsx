import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

export function AppErrorComponent({ error, reset }: ErrorComponentProps) {
  const detail = import.meta.env.DEV ? error.message : null;
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">
        NeuralLoom could not load this page. Try again. If the problem continues during local use,
        run <code className="font-mono">npm run doctor</code> in the terminal.
      </p>
      {detail ? (
        <details className="max-w-lg text-left text-xs text-zinc-500 dark:text-zinc-400">
          <summary className="cursor-pointer text-center">Technical details</summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
            {detail}
          </pre>
        </details>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-2 min-h-11 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-950"
      >
        Try again
      </button>
    </main>
  );
}
