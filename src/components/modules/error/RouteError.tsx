import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";

import { errorStatusOf } from "./error-status";
import { ErrorPage } from "./ErrorPage";

/**
 * The router's default error boundary: a loader's `ApiError` shows its status, anything else is a
 * 500. Retrying invalidates the router, which re-runs the loaders and resets the boundary (a bare
 * `reset()` would re-render without loading again).
 */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <ErrorPage
      status={errorStatusOf(error)}
      onRetry={() => router.invalidate()}
      details={error instanceof Error ? (error.stack ?? error.message) : String(error)}
    />
  );
}

/** The router's default not-found page: unknown paths, and `notFound()` from routes without one. */
export function RouteNotFound() {
  return <ErrorPage status={404} />;
}
