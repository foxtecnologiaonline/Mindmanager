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
  cancelInvoice,
  createManualInvoice,
  markInvoicePaid,
  undoInvoicePayment,
} from "@/lib/billing/actions";

export const metadata: Metadata = { title: "Financeiro" };

const METHOD_LABEL: Record<string, string> = {
  pix: "PIX",
  card: "Cartão",
  cash: "Dinheiro",
  other: "Outro",
};

type Status = "pending" | "paid" | "cancelled";

function resolveStatus(value: string | undefined): Status {
  return value === "paid" || value === "cancelled" ? value : "pending";
}

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function StatusTabs({ status }: { status: Status }) {
  const tabs: { key: Status; label: string }[] = [
    { key: "pending", label: "A receber" },
    { key: "paid", label: "Recebidas" },
    { key: "cancelled", label: "Canceladas" },
  ];
  return (
    <div className="inline-flex gap-1 rounded-lg border border-border bg-paper p-1 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/dashboard/financeiro?status=${tab.key}`}
          className={`rounded-md px-3 py-1.5 font-medium ${
            status === tab.key ? "bg-accent text-white" : "text-muted hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; undoInvoiceId?: string }>;
}) {
  const { tenantId } = await getTenantContext();
  const { status: statusParam, undoInvoiceId } = await searchParams;
  const status = resolveStatus(statusParam);
  const supabase = await createClient();

  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
  const monthStart = `${todayStr.slice(0, 7)}-01T00:00:00-03:00`;

  const [{ data: invoices }, { count: pendingCount }, { data: receivedThisMonth }, { data: patients }] =
    await Promise.all([
      supabase
        .from("invoices")
        .select(
          "id, amount_cents, method, status, paid_at, notes, created_at, patients ( id, full_name ), appointments ( starts_at, service_types ( name ) )",
        )
        .eq("tenant_id", tenantId)
        .eq("status", status)
        .order("created_at", { ascending: false }),
      supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "pending"),
      supabase
        .from("invoices")
        .select("amount_cents")
        .eq("tenant_id", tenantId)
        .eq("status", "paid")
        .gte("paid_at", monthStart),
      supabase
        .from("patients")
        .select("id, full_name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("full_name"),
    ]);

  const totalPendingCount = pendingCount ?? 0;
  const totalReceivedThisMonth = (receivedThisMonth ?? []).reduce(
    (sum, inv) => sum + inv.amount_cents,
    0,
  );

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="heading text-2xl">Financeiro</h1>

        <Suspense fallback={null}>
          <Toast
            undo={
              undoInvoiceId
                ? { action: undoInvoicePayment, fields: { id: undoInvoiceId }, label: "Desfazer" }
                : undefined
            }
          />
        </Suspense>

        <div className="grid grid-cols-2 gap-4">
          <div className="card p-4">
            <p className="text-2xl font-semibold text-ink">{totalPendingCount}</p>
            <p className="text-sm text-muted-soft">conta(s) a receber</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-semibold text-ink">{formatCents(totalReceivedThisMonth)}</p>
            <p className="text-sm text-muted-soft">recebido este mês</p>
          </div>
        </div>

        <p className="text-xs text-muted-soft">
          Pagamento é recebido por fora (PIX ou maquininha da própria clínica) — aqui só se
          acompanha quem já pagou e se emite recibo.
        </p>

        <StatusTabs status={status} />

        {(invoices ?? []).length === 0 ? (
          <EmptyState
            title={
              status === "pending"
                ? "Nenhuma conta a receber"
                : status === "paid"
                  ? "Nenhum recebimento ainda"
                  : "Nenhuma cobrança cancelada"
            }
            description={
              status === "pending"
                ? "Contas a receber aparecem automaticamente ao agendar uma consulta com preço cadastrado, ou podem ser criadas manualmente abaixo."
                : undefined
            }
          />
        ) : (
          <div className="card divide-y divide-border">
            {(invoices ?? []).map((inv) => {
              const patient = Array.isArray(inv.patients) ? inv.patients[0] : inv.patients;
              const appointment = Array.isArray(inv.appointments)
                ? inv.appointments[0]
                : inv.appointments;
              const service = appointment
                ? Array.isArray(appointment.service_types)
                  ? appointment.service_types[0]
                  : appointment.service_types
                : null;

              return (
                <div key={inv.id} className="flex items-center justify-between gap-3 p-4 text-sm">
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
                      {appointment?.starts_at
                        ? new Date(appointment.starts_at).toLocaleDateString("pt-BR")
                        : new Date(inv.created_at).toLocaleDateString("pt-BR")}
                      {inv.status === "paid" && inv.method && ` · ${METHOD_LABEL[inv.method]}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-ink">{formatCents(inv.amount_cents)}</span>
                    {inv.status === "pending" && (
                      <>
                        <form action={markInvoicePaid} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={inv.id} />
                          <select name="method" defaultValue="pix" className="input py-1 text-xs">
                            <option value="pix">PIX</option>
                            <option value="card">Cartão</option>
                            <option value="cash">Dinheiro</option>
                            <option value="other">Outro</option>
                          </select>
                          <SubmitButton pendingText="..." className="btn-primary px-2 py-1 text-xs">
                            Marcar pago
                          </SubmitButton>
                        </form>
                        <form action={cancelInvoice}>
                          <input type="hidden" name="id" value={inv.id} />
                          <ConfirmSubmitButton
                            confirmMessage="Cancelar esta cobrança?"
                            pendingText="..."
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            cancelar
                          </ConfirmSubmitButton>
                        </form>
                      </>
                    )}
                    {inv.status === "paid" && (
                      <Link
                        href={`/dashboard/financeiro/${inv.id}/recibo`}
                        className="btn-secondary px-2 py-1 text-xs"
                      >
                        Recibo
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            Criar cobrança manual
          </summary>
          <form action={createManualInvoice} className="mt-4 flex flex-wrap items-end gap-3 text-sm">
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
              <label className="font-medium text-ink">Valor (R$)</label>
              <input name="amount" type="number" min="0.01" step="0.01" required className="input w-28" />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-ink">Observação (opcional)</label>
              <input name="notes" className="input" />
            </div>
            <SubmitButton pendingText="Criando..." className="btn-primary">
              Criar cobrança
            </SubmitButton>
          </form>
        </details>
      </div>
    </main>
  );
}
