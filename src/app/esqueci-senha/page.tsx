import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Esqueci minha senha" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  if (sent) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card w-full max-w-sm space-y-4 p-8 text-center">
          <h1 className="heading text-2xl">Verifique seu e-mail</h1>
          <p className="text-sm text-muted">
            Se houver uma conta com esse e-mail, enviamos um link para
            redefinir a senha.
          </p>
          <Link href="/login" className="link-accent text-sm">
            Voltar para o login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        action={requestPasswordReset}
        className="card w-full max-w-sm space-y-4 p-8"
      >
        <h1 className="heading text-2xl">Esqueci minha senha</h1>
        <p className="text-sm text-muted">
          Informe seu e-mail para receber um link de redefinição de senha.
        </p>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            E-mail
          </label>
          <input id="email" name="email" type="email" required className="input" />
        </div>
        <SubmitButton pendingText="Enviando...">Enviar link</SubmitButton>
        <p className="text-sm text-muted">
          <Link href="/login" className="link-accent">
            Voltar para o login
          </Link>
        </p>
      </form>
    </main>
  );
}
