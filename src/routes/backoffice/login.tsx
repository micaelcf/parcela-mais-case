import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { login } from "#/api/backoffice";
import { LoginForm } from "#/components/modules/backoffice/LoginForm";
import type { LoginRequest } from "#/server/modules/backoffice/backoffice.dto";

export const Route = createFileRoute("/backoffice/login")({
  head: () => ({ meta: [{ title: "Entrar · Backoffice Parcela Mais" }] }),
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/backoffice" });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();

  async function signIn(values: LoginRequest): Promise<string | null> {
    const result = await login(values);
    if (!result.ok) return result.problem.title;
    await navigate({ to: "/backoffice" });
    return null;
  }

  return <LoginForm onSubmit={signIn} />;
}
