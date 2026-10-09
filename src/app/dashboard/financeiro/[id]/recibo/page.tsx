import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Recibo" };

const METHOD_LABEL: Record<string, string> = {
  pix: "PIX",
  card: "Cartão",
  cash: "Dinheiro",
  other: "Outro",
};

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantName } = await getTenantContext();
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
                  {new Date(appointment.starts_at).toLocaleDateString("pt-BR")}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-b border-border pb-2">
              <dt className="text-muted-soft">Forma de pagamento</dt>
              <dd className="font-medium text-ink">
                {invoice.method ? METHOD_LABEL[invoice.method] : "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b border-border pb-2">
              <dt className="text-muted-soft">Pago em</dt>
              <dd className="font-medium text-ink">
                {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString("pt-BR") : "—"}
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

        <PrintButton className="btn-secondary mx-auto block print:hidden">
          Imprimir / salvar PDF
        </PrintButton>
      </div>
    </main>
  );
}
