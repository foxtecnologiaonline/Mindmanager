import type { Metadata } from "next";
import Link from "next/link";
import { login } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const { error, email } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={login} className="card w-full max-w-sm space-y-4 p-8">
        <h1 className="heading text-2xl">Entrar</h1>
        {error && (
          <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={email}
            className="input"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-ink">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="input"
          />
        </div>
        <SubmitButton pendingText="Entrando...">Entrar</SubmitButton>
        <div className="flex items-center justify-between text-sm text-muted">
          <Link href="/signup" className="link-accent">
            Criar conta
          </Link>
          <Link href="/esqueci-senha" className="link-accent">
            Esqueci minha senha
          </Link>
        </div>
      </form>
    </main>
  );
}
