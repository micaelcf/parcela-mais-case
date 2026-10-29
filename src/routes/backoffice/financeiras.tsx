import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { getLenderMetrics, listSwitchLog, setLenderEnabled } from "#/api/backoffice";
import { LenderHealthTable } from "#/components/modules/backoffice/LenderHealthTable";
import { PageHeader, Section } from "#/components/modules/backoffice/PageHeader";
import { SwitchLogTable } from "#/components/modules/backoffice/SwitchLogTable";
import {
  listSearchValidator,
  parseListSearch,
  SwitchLogSearchSchema,
  toListQuery,
} from "#/components/modules/backoffice/table-search";
import { useServerList } from "#/components/modules/backoffice/use-server-list";
import { LENDER_NAME } from "#/components/modules/consultation/lender-copy";
import type { LenderCode } from "#/lib/enums";

const validateSearch = listSearchValidator(SwitchLogSearchSchema);

// The switch log loads its rows in the page (`useServerList`); the loader reads only the lender
// metrics, so paging the log neither re-runs it nor moves the page.
export const Route = createFileRoute("/backoffice/financeiras")({
  validateSearch,
  loader: async () => (await getLenderMetrics()).lenders,
  component: LendersPage,
});

function LendersPage() {
  const lenders = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const switchLog = useServerList(toListQuery(search), listSwitchLog);
  const [pendingLender, setPendingLender] = useState<LenderCode | null>(null);

  async function toggle(lender: LenderCode, enabled: boolean) {
    setPendingLender(lender);
    const result = await setLenderEnabled(lender, enabled);
    if (result.ok) {
      toast.success(`${LENDER_NAME[lender]} ${enabled ? "ativada" : "desativada"}`);
    } else {
      toast.error(result.problem.title);
    }
    switchLog.reload();
    await router.invalidate();
    setPendingLender(null);
  }

  return (
    <>
      <PageHeader
        title="Financeiras"
        description="Saúde nas últimas 24 horas, disjuntor e ativação de cada financeira."
      />
      <div className="flex flex-col gap-6">
        <Section
          title="Saúde e ativação"
          description="Desativar uma financeira faz as próximas consultas a pularem, sem chamá-la."
        >
          <LenderHealthTable
            lenders={lenders}
            pendingLender={pendingLender}
            onToggle={(lender, enabled) => void toggle(lender, enabled)}
          />
        </Section>
        <Section title="Histórico de ativação">
          <SwitchLogTable
            list={switchLog}
            query={search}
            onQueryChange={(patch) =>
              void navigate({
                search: (previous) => parseListSearch(validateSearch, { ...previous, ...patch }),
                resetScroll: false,
              })
            }
          />
        </Section>
      </div>
    </>
  );
}
