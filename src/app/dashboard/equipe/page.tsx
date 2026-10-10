import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { requireCapability, ROLE_LABEL, type Role } from "@/lib/permissions";
import { siteUrl } from "@/lib/site-url";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CopyLinkButton } from "@/components/copy-link-button";
import { createInvite, revokeInvite, changeMemberRole, removeMember } from "@/lib/team/actions";

export const metadata: Metadata = { title: "Equipe" };

export default async function TeamPage() {
  const { tenantId, userId, role } = await getTenantContext();
  requireCapability(role, "team");
  const supabase = await createClient();
  const base = await siteUrl();

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("tenant_id", tenantId)
      .order("full_name"),
    supabase
      .from("team_invites")
      .select("id, email, role, token, expires_at")
      .eq("tenant_id", tenantId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  ]);

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="heading text-2xl">Equipe</h1>

        <Suspense fallback={null}>
          <Toast />
        </Suspense>

        <p className="text-xs text-muted-soft">
          Administrador: tudo. Profissional: agenda, pacientes e prontuário. Recepção: agenda,
          pacientes e financeiro (sem acesso ao prontuário).
        </p>

        <section className="card divide-y divide-border">
          <h2 className="p-4 font-medium text-ink">Membros</h2>
          {(members ?? []).map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <p className="font-medium text-ink">
                {m.full_name || "Sem nome"}
                {m.id === userId && <span className="ml-2 text-xs text-muted-soft">(você)</span>}
              </p>
              <div className="flex items-center gap-2">
                <form action={changeMemberRole} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={m.id} />
                  <select name="role" defaultValue={m.role} className="input py-1 text-xs" aria-label={`Papel de ${m.full_name}`}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <SubmitButton pendingText="..." className="btn-secondary px-2 py-1 text-xs">
                    Salvar
                  </SubmitButton>
                </form>
                {m.id !== userId && (
                  <form action={removeMember}>
                    <input type="hidden" name="userId" value={m.id} />
                    <ConfirmSubmitButton
                      confirmMessage={`Remover ${m.full_name || "este membro"} da clínica?`}
                      pendingText="..."
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      remover
                    </ConfirmSubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))}
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-medium text-ink">Convidar pessoa</h2>
          <form action={createInvite} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-1">
              <label htmlFor="invite-email" className="text-sm font-medium text-ink">
                E-mail
              </label>
              <input id="invite-email" name="email" type="email" required maxLength={160} className="input" />
            </div>
            <div className="space-y-1">
              <label htmlFor="invite-role" className="text-sm font-medium text-ink">
                Papel
              </label>
              <select id="invite-role" name="role" className="input">
                <option value="profissional">{ROLE_LABEL.profissional}</option>
                <option value="recepcao">{ROLE_LABEL.recepcao}</option>
              </select>
            </div>
            <SubmitButton pendingText="Criando..." className="btn-primary">
              Criar convite
            </SubmitButton>
          </form>
          <p className="text-xs text-muted-soft">
            O sistema não envia e-mail: copie o link do convite e mande por WhatsApp ou e-mail.
            O link vale 7 dias, funciona uma vez e só com o e-mail informado.
          </p>
        </section>

        {(invites ?? []).length > 0 && (
          <section className="card divide-y divide-border">
            <h2 className="p-4 font-medium text-ink">Convites em aberto</h2>
            {(invites ?? []).map((inv) => {
              const link = `${base}/convite/${inv.token}`;
              return (
                <div key={inv.id} className="space-y-2 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-ink">
                      {inv.email} · {ROLE_LABEL[inv.role as Role]}
                    </p>
                    <form action={revokeInvite}>
                      <input type="hidden" name="id" value={inv.id} />
                      <ConfirmSubmitButton
                        confirmMessage="Cancelar este convite?"
                        pendingText="..."
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        cancelar
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-paper px-2 py-1 text-xs text-muted">{link}</code>
                    <CopyLinkButton text={link} />
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
