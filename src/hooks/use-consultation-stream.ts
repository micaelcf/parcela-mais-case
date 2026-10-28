import { useEffect, useState } from "react";

import { consultationSnapshots } from "#/api/consultations";
import type { ConsultationPublicView } from "#/server/modules/consultation/consultation.dto";

import { createReconnectBackoff } from "./reconnect-backoff";

/**
 * Keeps a consultation view live over SSE until it settles. `initial` is the loader's view; when
 * the loader re-runs (after a mutation) its newer view replaces the current one. Every connection
 * opens with a full snapshot that replaces state; a drop before `SETTLED` reconnects with backoff.
 */
export function useConsultationStream(initial: ConsultationPublicView): ConsultationPublicView {
  const [view, setView] = useState(initial);
  const [adopted, setAdopted] = useState(initial);
  if (initial !== adopted) {
    setAdopted(initial);
    setView(initial);
  }

  const id = view.id;
  const settled = view.quoteStatus === "SETTLED";

  useEffect(() => {
    if (settled) return;
    const backoff = createReconnectBackoff();
    let controller: AbortController | undefined;
    let retry: number | undefined;
    let stopped = false;

    async function connect() {
      controller?.abort();
      controller = new AbortController();
      try {
        for await (const snapshot of consultationSnapshots(id, controller.signal)) {
          backoff.reset();
          setView(snapshot);
          if (snapshot.quoteStatus === "SETTLED") return;
        }
      } catch {
        // A dropped connection or a failed request: fall through to the reconnect.
      }
      if (!stopped) retry = window.setTimeout(connect, backoff.next());
    }

    void connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      controller?.abort();
    };
  }, [id, settled]);

  return view;
}
