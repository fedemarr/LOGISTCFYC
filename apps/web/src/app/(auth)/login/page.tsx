"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    createSupabaseClient()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) router.replace("/");
      });
  }, [router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await createSupabaseClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);
    if (error) {
      setError("Email o contraseña incorrectos.");
      return;
    }
    router.replace("/");
  }

  return (
    <main className="bg-bg flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="bg-primary mb-1 flex size-11 items-center justify-center rounded-lg">
            <span className="text-primary-foreground text-xl font-bold">F</span>
          </div>
          <CardTitle>FYC — Panel de Operaciones</CardTitle>
          <CardDescription>Ingresá con tu usuario de trabajo.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@fyc.demo"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p
                className="bg-status-danger/10 text-status-danger rounded-md px-3 py-2 text-sm"
                role="alert"
              >
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting} className="h-9">
              {submitting ? (
                "Ingresando…"
              ) : (
                <>
                  <LogIn className="size-4" />
                  Ingresar
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
