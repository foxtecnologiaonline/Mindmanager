import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { siteUrl } from "@/lib/site-url";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState } from "@/components/empty-state";
import { CopyLinkButton } from "@/components/copy-link-button";
import {
  cancelInvoice,
  createManualInvoice,
  markInvoicePaid,
  undoInvoicePayment,
  updatePixSettings,
} from "@/lib/billing/actions";
import {
  cancelPaymentLink,
  confirmPaymentLinkReceived,
  createPaymentLink,
  undoPaymentLinkConfirmation,
} from "@/lib/billing/payment-links-actions";

export const metadata: Metadata = { title: "Financeiro" };

const METHOD_LABEL: Record<string, string> = {
  pix: "PIX",
  card: "Cartão",
  cash: "Dinheiro",
  other: "Outro",
};

type Status = "pending" | "paid" | "cancelled";
type View = "list" | "acerto" | "links";

function resolveStatus(value: string | undefined): Status {
  return value === "paid" || value === "cancelled" ? value : "pending";
}

function resolveView(value: string | undefined): View {
  return value === "acerto" || value === "links" ? value : "list";
}

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function ViewTabs({ view }: { view: View }) {
  const tabs: { key: View; label: string }[] = [
    { key: "list", label: "Cobranças" },
    { key: "acerto", label: "Acerto por paciente" },
    { key: "links", label: "Links de pagamento" },
  ];
  return (
    <div className="inline-flex gap-1 rounded-lg border border-border bg-paper p-1 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/dashboard/financeiro?view=${tab.key}`}
          className={`rounded-md px-3 py-1.5 font-medium ${
            view === tab.key ? "bg-accent text-white" : "text-muted hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
      <Link
        href="/dashboard/financeiro/pacotes"
        className="rounded-md px-3 py-1.5 font-medium text-muted hover:text-ink"
      >
        Pacotes
      </Link>
    </div>
  );
}

function StatusTabs({ status }: { status: Status }) {
  const tabs: { key: Status; label: string }[] = [
    { key: "pending", label: "A receber" },
    { key: "paid", label: "Recebidas" },
    { key: "cancelled", label: "Canceladas" },
  ];
  return (
    <div className="flex gap-4 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/dashboard/financeiro?status=${tab.key}`}
          className={status === tab.key ? "font-medium text-ink" : "text-muted-soft hover:text-ink"}
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
  searchParams: Promise<{
    status?: string;
    view?: string;
    undoInvoiceId?: string;
    undoLinkId?: string;
    linkCreated?: string;
  }>;
}) {
  const { tenantId } = await getTenantContext();
  const { status: statusParam, view: viewParam, undoInvoiceId, undoLinkId, linkCreated } =
    await searchParams;
  const status = resolveStatus(statusParam);
  const view = resolveView(viewParam);
  const supabase = await createClient();

  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
  const monthStart = `${todayStr.slice(0, 7)}-01T00:00:00-03:00`;

  const [{ data: tenant }, { count: pendingCount }, { data: receivedThisMonth }] = await Promise.all([
    supabase.from("tenants").select("pix_key, pix_holder_name, pix_city").eq("id", tenantId).single(),
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
  ]);
  const pixConfigured = Boolean(tenant?.pix_key && tenant?.pix_holder_name && tenant?.pix_city);

  const totalPendingCount = pendingCount ?? 0;
  const totalReceivedThisMonth = (receivedThisMonth ?? []).reduce(
    (sum, inv) => sum + inv.amount_cents,
    0,
  );

  const header = (
    <>
      <h1 className="heading text-2xl">Financeiro</h1>

      <Suspense fallback={null}>
        <Toast
          undo={
            undoInvoiceId
              ? { action: undoInvoicePayment, fields: { id: undoInvoiceId }, label: "Desfazer" }
              : undoLinkId
                ? {
                    action: undoPaymentLinkConfirmation,
                    fields: { id: undoLinkId },
                    label: "Desfazer",
                  }
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
        acompanha quem já pagou, se gera link de pagamento e se emite recibo.
      </p>

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          Configurar Pix da clínica {pixConfigured ? "✓" : "— necessário pra gerar link de pagamento"}
        </summary>
        <form action={updatePixSettings} className="mt-4 flex flex-wrap items-end gap-3 text-sm">
          <div className="space-y-1">
            <label className="font-medium text-ink">Chave Pix</label>
            <input name="pixKey" required defaultValue={tenant?.pix_key ?? ""} className="input" />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-ink">Nome do titular</label>
            <input
              name="pixHolderName"
              required
              maxLength={25}
              defaultValue={tenant?.pix_holder_name ?? ""}
              className="input"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-ink">Cidade</label>
            <input
              name="pixCity"
              required
              maxLength={15}
              defaultValue={tenant?.pix_city ?? ""}
              className="input w-40"
            />
          </div>
          <SubmitButton pendingText="Salvando..." className="btn-primary">
            Salvar
          </SubmitButton>
        </form>
      </details>

      <ViewTabs view={view} />
    </>
  );

  if (view === "links") {
    const { data: links } = await supabase
      .from("payment_links")
      .select("id, amount_cents, status, created_at, invoice_ids, patients ( id, full_name )")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50);

    const base = await siteUrl();

    return (
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {header}

          {linkCreated && (
            <div className="card space-y-2 border-accent/40 bg-accent-soft p-4 text-sm">
              <p className="font-medium text-ink">Link criado — envie para o paciente:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-surface p-2 text-xs">
                  {base}/pagar/{linkCreated}
                </code>
                <CopyLinkButton text={`${base}/pagar/${linkCreated}`} />
              </div>
            </div>
          )}

          {(links ?? []).length === 0 ? (
            <EmptyState
              title="Nenhum link de pagamento ainda"
              description="Gere um a partir de uma cobrança pendente ou do acerto por paciente."
            />
          ) : (
            <div className="card divide-y divide-border">
              {(links ?? []).map((link) => {
                const patient = Array.isArray(link.patients) ? link.patients[0] : link.patients;
                const url = `${base}/pagar/${link.id}`;
                return (
                  <div key={link.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                    <div>
                      <p className="font-medium text-ink">{patient?.full_name ?? "—"}</p>
                      <p className="text-muted-soft">
                        {link.invoice_ids.length} cobrança(s) ·{" "}
                        {new Date(link.created_at).toLocaleDateString("pt-BR")} ·{" "}
                        <span
                          className={
                            link.status === "open"
                              ? "text-amber-700"
                              : link.status === "paid"
                                ? "text-blue-700"
                                : "text-muted-soft"
                          }
                        >
                          {link.status === "open" ? "aberto" : link.status === "paid" ? "pago" : "cancelado"}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{formatCents(link.amount_cents)}</span>
                      {link.status === "open" && (
                        <>
                          <CopyLinkButton text={url} label="Copiar link" />
                          <form action={confirmPaymentLinkReceived} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={link.id} />
                            <select name="method" defaultValue="pix" className="input py-1 text-xs">
                              <option value="pix">PIX</option>
                              <option value="card">Cartão</option>
                              <option value="cash">Dinheiro</option>
                              <option value="other">Outro</option>
                            </select>
                            <SubmitButton pendingText="..." className="btn-primary px-2 py-1 text-xs">
                              Confirmar recebido
                            </SubmitButton>
                          </form>
                          <form action={cancelPaymentLink}>
                            <input type="hidden" name="id" value={link.id} />
                            <ConfirmSubmitButton
                              confirmMessage="Cancelar este link de pagamento?"
                              pendingText="..."
                              className="text-xs font-medium text-red-600 hover:text-red-700"
                            >
                              cancelar
                            </ConfirmSubmitButton>
                          </form>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    );
  }

  if (view === "acerto") {
    const { data: pendingInvoices } = await supabase
      .from("invoices")
      .select("id, amount_cents, patient_id, patients ( id, full_name )")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .not("patient_id", "is", null)
      .order("created_at");

    type PatientGroup = { patientName: string; invoiceIds: string[]; total: number };
    const byPatient = new Map<string, PatientGroup>();
    for (const inv of pendingInvoices ?? []) {
      const patient = Array.isArray(inv.patients) ? inv.patients[0] : inv.patients;
      const patientId: string | null = inv.patient_id;
      if (!patientId || !patient) continue;

      const entry: PatientGroup =
        byPatient.get(patientId) ?? { patientName: patient.full_name, invoiceIds: [], total: 0 };
      entry.invoiceIds.push(inv.id as string);
      entry.total += inv.amount_cents;
      byPatient.set(patientId, entry);
    }

    const groups = Array.from(byPatient.entries()).map(([patientId, data]) => ({
      patientId,
      ...data,
    }));

    return (
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {header}

          {groups.length === 0 ? (
            <EmptyState
              title="Nenhum acerto pendente"
              description="Quando houver cobranças pendentes, elas aparecem aqui agrupadas por paciente, prontas pra consolidar num link de pagamento só."
            />
          ) : (
            <div className="card divide-y divide-border">
              {groups.map((g) => (
                <div key={g.patientId} className="flex items-center justify-between gap-3 p-4 text-sm">
                  <div>
                    <Link href={`/dashboard/pacientes/${g.patientId}`} className="font-medium text-ink hover:underline">
                      {g.patientName}
                    </Link>
                    <p className="text-muted-soft">{g.invoiceIds.length} sessão(ões) pendente(s)</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-ink">{formatCents(g.total)}</span>
                    <form action={createPaymentLink}>
                      <input type="hidden" name="patientId" value={g.patientId} />
                      {g.invoiceIds.map((id) => (
                        <input key={id} type="hidden" name="invoiceIds" value={id} />
                      ))}
                      <SubmitButton
                        pendingText="Gerando..."
                        className="btn-primary px-3 py-1.5 text-xs"
                      >
                        Gerar link de pagamento
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  // view === "list"
  const [{ data: invoices }, { data: patients }] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, amount_cents, method, status, paid_at, notes, created_at, patient_id, patients ( id, full_name ), appointments ( starts_at, service_types ( name ) )",
      )
      .eq("tenant_id", tenantId)
      .eq("status", status)
      .order("created_at", { ascending: false }),
    supabase
      .from("patients")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("full_name"),
  ]);

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {header}

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
                  <div className="flex items-center gap-2">
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
                        {inv.patient_id && (
                          <form action={createPaymentLink}>
                            <input type="hidden" name="patientId" value={inv.patient_id} />
                            <input type="hidden" name="invoiceIds" value={inv.id} />
                            <SubmitButton
                              pendingText="..."
                              className="btn-secondary px-2 py-1 text-xs"
                            >
                              Gerar link
                            </SubmitButton>
                          </form>
                        )}
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
