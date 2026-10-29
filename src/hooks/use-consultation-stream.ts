import { useEffect, useState } from "react";

import { consultationSnapshots, getConsultation } from "#/api/consultations";
import type { ConsultationPublicView } from "#/server/modules/consultation/consultation.dto";

import { type FeedTransport, startConsultationFeed } from "./consultation-feed";

/**
 * Keeps a consultation view live until it settles (`consultation-feed.ts`): SSE first, polling
 * the read endpoint while the stream is unusable. `initial` is the loader's view; when the loader
 * re-runs (after a mutation) its newer view replaces the current one.
 */
export function useConsultationStream(initial: ConsultationPublicView): {
  view: ConsultationPublicView;
  transport: FeedTransport;
} {
  const [view, setView] = useState(initial);
  const [transport, setTransport] = useState<FeedTransport>("stream");
  const [adopted, setAdopted] = useState(initial);
  if (initial !== adopted) {
    setAdopted(initial);
    setView(initial);
  }

  const id = view.id;
  const settled = view.quoteStatus === "SETTLED";

  useEffect(() => {
    if (settled) return;
    // The feed only needs the id and the deadline, which don't change for this consultation.
    return startConsultationFeed(
      view,
      {
        stream: (signal) => consultationSnapshots(id, signal),
        read: () => getConsultation(id),
      },
      { view: setView, transport: setTransport },
    );
  }, [id, settled]);

  return { view, transport };
}
