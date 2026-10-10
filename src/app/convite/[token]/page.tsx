import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { signupWithInvite } from "@/lib/team/actions";
import { SubmitButton } from "@/components/submit-button";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

export const metadata: Metadata = { title: "Convite", robots: { index: false } };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const { data } = await createPublicClient().rpc("get_invite_info", { p_token: token });
  const invite = (data as { tenant_name: string; role: Role; email: string }[] | null)?.[0];

  if (!invite) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card w-full max-w-sm space-y-4 p-8 text-center">
          <h1 className="heading text-2xl">Convite indisponível</h1>
          <p className="text-sm text-muted">
            Esse convite expirou, já foi usado ou foi cancelado. Peça um novo ao administrador da clínica.
          </p>
          <Link href="/login" className="link-accent text-sm">
            Ir para o login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={signupWithInvite} className="card w-full max-w-sm space-y-4 p-8">
        <input type="hidden" name="token" value={token} />
        <div>
          <h1 className="heading text-2xl">Entrar na equipe</h1>
          <p className="mt-1 text-sm text-muted">
            Você foi convidado(a) para <strong>{invite.tenant_name}</strong> como{" "}
            {ROLE_LABEL[invite.role] ?? invite.role}.
          </p>
        </div>
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            E-mail
          </label>
          <input id="email" value={invite.email} readOnly className="input bg-paper" />
        </div>
        <div className="space-y-1">
          <label htmlFor="fullName" className="text-sm font-medium text-ink">
            Nome completo
          </label>
          <input id="fullName" name="fullName" required maxLength={120} className="input" />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-ink">
            Senha
          </label>
          <input id="password" name="password" type="password" minLength={6} required className="input" />
        </div>
        <SubmitButton pendingText="Criando conta...">Criar conta e entrar</SubmitButton>
      </form>
    </main>
  );
}
