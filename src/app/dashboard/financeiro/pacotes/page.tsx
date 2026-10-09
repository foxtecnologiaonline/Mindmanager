import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState } from "@/components/empty-state";
import {
  cancelPackage,
  createPackage,
  registerPackageSession,
  undoPackageSession,
} from "@/lib/billing/packages-actions";

export const metadata: Metadata = { title: "Pacotes de sessão" };

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function PackagesPage() {
  const { tenantId } = await getTenantContext();
  const supabase = await createClient();

  const [{ data: packages }, { data: patients }, { data: serviceTypes }] = await Promise.all([
    supabase
      .from("session_packages")
      .select(
        "id, sessions_total, sessions_used, amount_cents, status, created_at, patients ( id, full_name ), service_types ( name )",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("patients")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("full_name"),
    supabase
      .from("service_types")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name"),
  ]);

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="heading text-2xl">Pacotes de sessão</h1>
          <Link href="/dashboard/financeiro" className="link-accent text-sm">
            Voltar ao financeiro
          </Link>
        </div>

        <Suspense fallback={null}>
          <Toast />
        </Suspense>

        <p className="text-xs text-muted-soft">
          Pra quando o paciente paga várias sessões de uma vez — registra o pacote já como pago
          (emite recibo) e acompanha quantas sessões ainda restam. Dar baixa numa sessão é manual,
          não ligado automaticamente ao agendamento na agenda.
        </p>

        {(packages ?? []).length === 0 ? (
          <EmptyState
            title="Nenhum pacote cadastrado"
            description="Crie um pacote abaixo quando um paciente pagar várias sessões de uma vez."
          />
        ) : (
          <div className="card divide-y divide-border">
            {(packages ?? []).map((pkg) => {
              const patient = Array.isArray(pkg.patients) ? pkg.patients[0] : pkg.patients;
              const service = Array.isArray(pkg.service_types)
                ? pkg.service_types[0]
                : pkg.service_types;
              const remaining = pkg.sessions_total - pkg.sessions_used;

              return (
                <div key={pkg.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                  <div>
                    <p className="font-medium text-ink">
                      {patient ? (
                        <Link href={`/dashboard/pacientes/${patient.id}`} className="hover:underline">
                          {patient.full_name}
                        </Link>
                      ) : (
                        "Paciente removido"
                      )}
                    </p>
                    <p className="text-muted-soft">
                      {service?.name && `${service.name} · `}
                      {pkg.sessions_used}/{pkg.sessions_total} sessões usadas ·{" "}
                      {formatCents(pkg.amount_cents)}
                      {pkg.status === "cancelled" && " · cancelado"}
                      {pkg.status === "completed" && " · concluído"}
                    </p>
                  </div>
                  {pkg.status !== "cancelled" && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-soft">{remaining} restante(s)</span>
                      {pkg.sessions_used > 0 && (
                        <form action={undoPackageSession}>
                          <input type="hidden" name="id" value={pkg.id} />
                          <SubmitButton
                            pendingText="..."
                            className="text-xs font-medium text-muted hover:text-ink"
                          >
                            desfazer sessão
                          </SubmitButton>
                        </form>
                      )}
                      {pkg.status === "active" && (
                        <form action={registerPackageSession}>
                          <input type="hidden" name="id" value={pkg.id} />
                          <SubmitButton pendingText="..." className="btn-primary px-2 py-1 text-xs">
                            Registrar sessão usada
                          </SubmitButton>
                        </form>
                      )}
                      <form action={cancelPackage}>
                        <input type="hidden" name="id" value={pkg.id} />
                        <ConfirmSubmitButton
                          confirmMessage="Cancelar este pacote?"
                          pendingText="..."
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          cancelar
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            Registrar novo pacote
          </summary>
          <form action={createPackage} className="mt-4 flex flex-wrap items-end gap-3 text-sm">
            <div className="space-y-1">
              <label className="font-medium text-ink">Paciente</label>
              <select name="patientId" required className="input">
                {(patients ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-medium text-ink">Serviço (opcional)</label>
              <select name="serviceTypeId" className="input">
                <option value="">—</option>
                {(serviceTypes ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-medium text-ink">Nº de sessões</label>
              <input
                name="sessionsTotal"
                type="number"
                min={1}
                step={1}
                required
                className="input w-24"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-ink">Valor total (R$)</label>
              <input name="amount" type="number" min="0.01" step="0.01" required className="input w-28" />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-ink">Recebido via</label>
              <select name="method" defaultValue="pix" className="input">
                <option value="pix">PIX</option>
                <option value="card">Cartão</option>
                <option value="cash">Dinheiro</option>
                <option value="other">Outro</option>
              </select>
            </div>
            <SubmitButton pendingText="Registrando..." className="btn-primary">
              Registrar pacote pago
            </SubmitButton>
          </form>
        </details>
      </div>
    </main>
  );
}
