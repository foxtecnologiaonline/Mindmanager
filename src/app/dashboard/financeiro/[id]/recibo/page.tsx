import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { requireCapability } from "@/lib/permissions";
import { PrintButton } from "@/components/print-button";
import { methodLabel } from "@/lib/billing/payment-method";
import { formatCents } from "@/lib/billing/money";

export const metadata: Metadata = { title: "Recibo" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantName, role } = await getTenantContext();
  requireCapability(role, "finance");
  const supabase = await createClient();
  const { id } = await params;

  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "id, amount_cents, method, status, paid_at, created_at, patients ( full_name ), appointments ( starts_at, service_types ( name ) )",
    )
    .eq("id", id)
    .eq("status", "paid")
    .single();

  if (!invoice) {
    notFound();
  }

  const patient = Array.isArray(invoice.patients) ? invoice.patients[0] : invoice.patients;
  const appointment = Array.isArray(invoice.appointments) ? invoice.appointments[0] : invoice.appointments;
  const service = appointment
    ? Array.isArray(appointment.service_types)
      ? appointment.service_types[0]
      : appointment.service_types
    : null;

  return (
    <main className="flex-1 p-6 print:p-0">
      <div className="mx-auto max-w-lg space-y-6 print:max-w-none">
        <div className="card space-y-4 p-6 print:border-none print:shadow-none">
          <div className="text-center">
            <h1 className="heading text-xl">{tenantName}</h1>
            <p className="text-sm text-muted-soft">Recibo de pagamento</p>
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-border pb-2">
              <dt className="text-muted-soft">Paciente</dt>
              <dd className="font-medium text-ink">{patient?.full_name ?? "—"}</dd>
            </div>
            {service?.name && (
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-soft">Serviço</dt>
                <dd className="font-medium text-ink">{service.name}</dd>
              </div>
            )}
            {appointment?.starts_at && (
              <div className="flex justify-between border-b border-border pb-2">
                <dt className="text-muted-soft">Data da consulta</dt>
                <dd className="font-medium text-ink">
                  {new Date(appointment.starts_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-b border-border pb-2">
              <dt className="text-muted-soft">Forma de pagamento</dt>
              <dd className="font-medium text-ink">
                {methodLabel(invoice.method)}
              </dd>
            </div>
            <div className="flex justify-between border-b border-border pb-2">
              <dt className="text-muted-soft">Pago em</dt>
              <dd className="font-medium text-ink">
                {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}
              </dd>
            </div>
            <div className="flex justify-between pt-1 text-base">
              <dt className="font-medium text-ink">Valor</dt>
              <dd className="font-semibold text-ink">{formatCents(invoice.amount_cents)}</dd>
            </div>
          </dl>

          <p className="text-center text-[11px] text-muted-soft">
            Recibo gerado por {tenantName} via MindManager.
          </p>
        </div>

        <div className="flex justify-center gap-3 print:hidden">
          <a href={`/dashboard/financeiro/${invoice.id}/recibo/pdf`} className="btn-primary">
            Baixar PDF
          </a>
          <PrintButton className="btn-secondary">Imprimir</PrintButton>
        </div>
      </div>
    </main>
  );
}
