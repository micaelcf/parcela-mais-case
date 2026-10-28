import { createFileRoute, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { getSession, logout } from "#/api/backoffice";
import { BackofficeShell } from "#/components/BackofficeShell";

const LOGIN_PATH = "/backoffice/login";

export const Route = createFileRoute("/backoffice")({
  head: () => ({ meta: [{ title: "Parcela Mais · Backoffice" }] }),
  // Every backoffice page but the login needs a session (RF-602); the login page reads it too.
  beforeLoad: async ({ location }) => {
    const session = await getSession();
    if (!session && location.pathname !== LOGIN_PATH) throw redirect({ to: LOGIN_PATH });
    return { session };
  },
  component: BackofficeLayout,
});

function BackofficeLayout() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  async function signOut() {
    setLoggingOut(true);
    const result = await logout();
    setLoggingOut(false);
    if (!result.ok && result.problem.status !== 401) {
      toast.error(result.problem.title);
      return;
    }
    await navigate({ to: LOGIN_PATH });
    await router.invalidate();
  }

  return (
    <BackofficeShell
      operator={session?.username ?? null}
      loggingOut={loggingOut}
      onLogout={() => void signOut()}
    >
      <Outlet />
    </BackofficeShell>
  );
}
