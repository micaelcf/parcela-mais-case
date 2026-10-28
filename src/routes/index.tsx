import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold">Parcela Mais</h1>
      <p className="mt-2 text-neutral-600">Pré-aprovação de crédito para tratamentos.</p>
    </main>
  );
}
