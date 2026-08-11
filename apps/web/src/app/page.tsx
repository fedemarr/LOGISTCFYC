import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="bg-bg text-text flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold">Lastmile</h1>
        <p className="text-text-muted">
          Panel de Operaciones — FASE 1 (scaffolding). Todavía sin funcionalidad.
        </p>
      </div>
      <Button disabled>Próximamente</Button>
    </main>
  );
}
