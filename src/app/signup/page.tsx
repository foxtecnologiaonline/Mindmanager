import Link from "next/link";
import { signup } from "@/lib/actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={signup} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Criar conta</h1>
        {error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="fullName" className="text-sm font-medium">
            Nome completo
          </label>
          <input
            id="fullName"
            name="fullName"
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={6}
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded bg-black py-2 text-white"
        >
          Criar conta
        </button>
        <p className="text-sm text-neutral-600">
          Já tem conta?{" "}
          <Link href="/login" className="underline">
            Entrar
          </Link>
        </p>
      </form>
    </main>
  );
}
