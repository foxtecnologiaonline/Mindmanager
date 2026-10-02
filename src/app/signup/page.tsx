import Link from "next/link";
import { signup } from "@/lib/actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; checkEmail?: string }>;
}) {
  const { error, checkEmail } = await searchParams;

  if (checkEmail) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card w-full max-w-sm space-y-4 p-8 text-center">
          <h1 className="heading text-2xl">Confirme seu e-mail</h1>
          <p className="text-sm text-muted">
            Enviamos um link de confirmação para o e-mail informado. Clique
            nele para ativar sua conta e continuar o cadastro da clínica.
          </p>
          <Link href="/login" className="link-accent text-sm">
            Já confirmou? Entrar
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={signup} className="card w-full max-w-sm space-y-4 p-8">
        <h1 className="heading text-2xl">Criar conta</h1>
        {error && (
          <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="fullName" className="text-sm font-medium text-ink">
            Nome completo
          </label>
          <input id="fullName" name="fullName" required className="input" />
        </div>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            E-mail
          </label>
          <input id="email" name="email" type="email" required className="input" />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-ink">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={6}
            required
            className="input"
          />
        </div>
        <button type="submit" className="btn-primary w-full">
          Criar conta
        </button>
        <p className="text-sm text-muted">
          Já tem conta?{" "}
          <Link href="/login" className="link-accent">
            Entrar
          </Link>
        </p>
      </form>
    </main>
  );
}
