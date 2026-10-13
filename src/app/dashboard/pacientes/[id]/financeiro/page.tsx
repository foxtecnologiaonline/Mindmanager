import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { can, requireCapability } from "@/lib/permissions";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState } from "@/components/empty-state";
import { formatCents } from "@/lib/billing/money";
import { BR_DATE_TIME } from "@/lib/billing/format";
import { PAYMENT_METHODS, methodLabel } from "@/lib/billing/payment-method";
import { updatePatientBillingProfile } from "@/lib/billing/patient-billing-actions";

export const metadata: Metadata = { title: "Financeiro do paciente" };

const RECURRENCE_LABEL: Record<string, string> = {
  avulso: "Avulso (cobra por consulta)",
  pacote: "Pacote de sessões",
  mensal: "Mensalidade",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  paid: "Pago",
  cancelled: "Cancelado",
};

type Invoice = {
  id: string;
  amount_cents: number;
  status: string;
  method: string | null;
  paid_at: string | null;
  paid_via_link_id: string | null;
  notes: string | null;
  created_at: string;
};

export default async function PatientFinanceiroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: patientId } = await params;
  const { tenantId, role } = await getTenantContext();
  requireCapability(role, "finance");
  const supabase = await createClient();

  const { data: patient } = await supabase
    .from("patients")
    .select("id, full_name")
    .eq("id", patientId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .single();

  if (!patient) notFound();

  const [{ data: profile }, { data: invoices }, { data: packages }, { data: links }] =
    await Promise.all([
      supabase
        .from("patient_billing_profiles")
        .select("preferred_payment_method, billing_recurrence, billing_notes, updated_at")
        .eq("patient_id", patientId)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("id, amount_cents, status, method, paid_at, paid_via_link_id, notes, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("session_packages")
        .select("id, sessions_total, sessions_used, amount_cents, status, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("payment_links")
        .select("id, status")
        .eq("patient_id", patientId),
    ]);

  const allInvoices = (invoices ?? []) as Invoice[];
  const linkStatusById = new Map((links ?? []).map((l) => [l.id as string, l.status as string]));

  const pendingCents = allInvoices
    .filter((i) => i.status === "pending")
    .reduce((sum, i) => sum + i.amount_cents, 0);
  const paidCents = allInvoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + i.amount_cents, 0);

  // Conciliação automática (sem gateway/integração bancária): confere se
  // toda fatura paga "via link" aponta pra um link que também está pago —
  // se o link foi cancelado depois (ex: reaberto por engano), a fatura
  // fica com um vínculo inconsistente e precisa de olhar humano.
  const inconsistent = allInvoices.filter(
    (i) =>
      i.status === "paid" &&
      i.paid_via_link_id &&
      linkStatusById.get(i.paid_via_link_id) !== "paid",
  );

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="heading text-2xl">Financeiro</h1>
            <p className="text-sm text-muted">{patient.full_name}</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/dashboard/pacientes/${patientId}`} className="btn-secondary px-3 py-1.5 text-xs">
              Cadastro
            </Link>
            {can(role, "clinical") && (
              <Link
                href={`/dashboard/pacientes/${patientId}/prontuario`}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                Prontuário
              </Link>
            )}
            <a
              href={`/dashboard/pacientes/${patientId}/financeiro/fatura`}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Baixar fatura (PDF)
            </a>
          </div>
        </div>

        <Suspense fallback={null}>
          <Toast />
        </Suspense>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-xs text-muted-soft">Pendente</p>
            <p className="text-xl font-semibold text-ink">{formatCents(pendingCents)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted-soft">Pago (histórico)</p>
            <p className="text-xl font-semibold text-ink">{formatCents(paidCents)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted-soft">Pacotes ativos</p>
            <p className="text-xl font-semibold text-ink">
              {(packages ?? []).filter((p) => p.status === "active").length}
            </p>
          </div>
        </section>

        {inconsistent.length > 0 && (
          <div className="card space-y-1 border-amber-300 p-4 text-sm">
            <p className="font-medium text-amber-700">
              ⚠ {inconsistent.length} cobrança(s) com vínculo de pagamento inconsistente
            </p>
            <p className="text-xs text-muted-soft">
              Marcada(s) como paga via um link de pagamento que não está mais com status
              &quot;pago&quot; (foi cancelado ou reaberto depois). Vale confirmar manualmente se o
              valor foi recebido.
            </p>
          </div>
        )}

        <section className="card space-y-4 p-4">
          <h2 className="font-medium text-ink">Forma de recebimento e recorrência</h2>
          <p className="text-xs text-muted-soft">
            Classificação informativa — não gera cobrança automática. Pacotes de sessão continuam
            sendo controlados em{" "}
            <Link href="/dashboard/financeiro/pacotes" className="link-accent">
              Financeiro › Pacotes
            </Link>
            .
          </p>
          <form action={updatePatientBillingProfile} className="space-y-3 text-sm">
            <input type="hidden" name="patientId" value={patientId} />
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <label htmlFor="preferredPaymentMethod" className="font-medium text-ink">
                  Forma de recebimento preferida
                </label>
                <select
                  id="preferredPaymentMethod"
                  name="preferredPaymentMethod"
                  defaultValue={profile?.preferred_payment_method ?? ""}
                  className="input"
                >
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {methodLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="billingRecurrence" className="font-medium text-ink">
                  Recorrência
                </label>
                <select
                  id="billingRecurrence"
                  name="billingRecurrence"
                  defaultValue={profile?.billing_recurrence ?? "avulso"}
                  className="input"
                >
                  {Object.entries(RECURRENCE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="billingNotes" className="font-medium text-ink">
                Observações (opcional)
              </label>
              <textarea
                id="billingNotes"
                name="billingNotes"
                rows={2}
                maxLength={300}
                defaultValue={profile?.billing_notes ?? ""}
                className="input w-full"
              />
            </div>
            <SubmitButton pendingText="Salvando..." className="btn-primary px-3 py-1.5 text-sm">
              Salvar
            </SubmitButton>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium text-ink">Histórico de cobranças</h2>
          {allInvoices.length === 0 ? (
            <EmptyState
              title="Nenhuma cobrança ainda"
              description="Cobranças deste paciente (de consultas ou avulsas) aparecem aqui."
            />
          ) : (
            <div className="card divide-y divide-border text-sm">
              {allInvoices.map((inv) => (
                <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div>
                    <p className="text-ink">
                      {formatCents(inv.amount_cents)} ·{" "}
                      <span
                        className={
                          inv.status === "paid"
                            ? "text-accent"
                            : inv.status === "cancelled"
                              ? "text-muted-soft"
                              : "text-amber-700"
                        }
                      >
                        {STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                      {inv.status === "paid" && ` · ${methodLabel(inv.method)}`}
                    </p>
                    <p className="text-xs text-muted-soft">
                      {BR_DATE_TIME.format(new Date(inv.created_at))}
                      {inv.notes && ` · ${inv.notes}`}
                    </p>
                  </div>
                  {inv.status === "paid" && (
                    <Link
                      href={`/dashboard/financeiro/${inv.id}/recibo`}
                      className="link-accent text-xs"
                    >
                      Recibo
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {(packages ?? []).length > 0 && (
          <section className="space-y-3">
            <h2 className="font-medium text-ink">Pacotes de sessão</h2>
            <div className="card divide-y divide-border text-sm">
              {(packages ?? []).map((pkg) => (
                <div key={pkg.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <p className="text-ink">
                    {pkg.sessions_used}/{pkg.sessions_total} sessões usadas ·{" "}
                    {formatCents(pkg.amount_cents)}
                  </p>
                  <span className="text-xs text-muted-soft">
                    {pkg.status === "active"
                      ? "Ativo"
                      : pkg.status === "completed"
                        ? "Concluído"
                        : "Cancelado"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
