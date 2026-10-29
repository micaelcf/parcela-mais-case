import { isRedirect, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState } from "react";

import type { ListResponse } from "#/lib/list/list-contract";

/** A server-paged list as a table shows it: the rows it has, and whether newer ones are coming. */
export type ServerList<Item> = {
  /** The latest response; kept on screen while the next query loads. Null until the first one. */
  response: ListResponse<Item> | null;
  /** A response for the current query is on its way. */
  loading: boolean;
  /** Why the current query failed (the API's pt-BR title), or null. */
  error: string | null;
  /** Loads the current query again (after a change the list must reflect, or to retry). */
  reload: () => void;
};

type Settled<Item> = { key: string; response: ListResponse<Item> | null; error: string | null };

const LOAD_FAILED = "Não foi possível carregar a lista.";

/**
 * Loads one page of a server list for `query` and keeps the previous page on screen while the
 * next one loads (stale-while-loading), so changing page, sort or filters never blanks the table
 * nor the page around it. A response for a query since replaced is dropped; a 401 follows the API
 * layer's redirect to the login page.
 *
 * Tables own their list instead of a route loader keyed on the search params: a loader would
 * re-run the whole route (and its other reads) on every page change.
 */
export function useServerList<Query, Item>(
  query: Query,
  fetchList: (query: Query) => Promise<ListResponse<Item>>,
): ServerList<Item> {
  const router = useRouter();
  const [generation, setGeneration] = useState(0);
  const [settled, setSettled] = useState<Settled<Item> | null>(null);
  const key = `${generation}:${JSON.stringify(query)}`;
  const load = useEffectEvent(() => fetchList(query));

  useEffect(() => {
    let current = true;
    load().then(
      (response) => {
        if (current) setSettled({ key, response, error: null });
      },
      (cause: unknown) => {
        if (!current) return;
        if (isRedirect(cause)) {
          void router.navigate(cause.options);
          return;
        }
        const error = cause instanceof Error && cause.message ? cause.message : LOAD_FAILED;
        setSettled((previous) => ({ key, response: previous?.response ?? null, error }));
      },
    );
    return () => {
      current = false;
    };
  }, [key, router]);

  const fresh = settled?.key === key;
  return {
    response: settled?.response ?? null,
    loading: !fresh,
    error: fresh ? settled.error : null,
    reload: () => setGeneration((count) => count + 1),
  };
}
