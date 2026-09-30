import Link from "next/link";
import { requestPasswordReset } from "@/lib/actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  if (sent) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Verifique seu e-mail</h1>
          <p className="text-sm text-neutral-600">
            Se houver uma conta com esse e-mail, enviamos um link para
            redefinir a senha.
          </p>
          <Link href="/login" className="text-sm underline">
            Voltar para o login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={requestPasswordReset} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Esqueci minha senha</h1>
        <p className="text-sm text-neutral-600">
          Informe seu e-mail para receber um link de redefinição de senha.
        </p>
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
        <button
          type="submit"
          className="w-full rounded bg-black py-2 text-white"
        >
          Enviar link
        </button>
        <p className="text-sm text-neutral-600">
          <Link href="/login" className="underline">
            Voltar para o login
          </Link>
        </p>
      </form>
    </main>
  );
}
