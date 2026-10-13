import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { requireCapability } from "@/lib/permissions";
import { PrintButton } from "@/components/print-button";
import { EmptyState } from "@/components/empty-state";
import { monthLabel, resolveMonth, shiftMonth, currentMonthBR } from "@/lib/billing/period";
import { fetchReceived, totalsByMethod } from "@/lib/billing/reports";
import { methodLabel } from "@/lib/billing/payment-method";
import { formatCents } from "@/lib/billing/money";
import { BR_DATE_TIME } from "@/lib/billing/format";

export const metadata: Metadata = { title: "Recebimentos" };

export default async function ReceivedPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { tenantId, role, tenantName } = await getTenantContext();
  requireCapability(role, "finance");
  const month = resolveMonth((await searchParams).month);
  const supabase = await createClient();

  const [rows, { data: pending }] = await Promise.all([
    fetchReceived(supabase, tenantId, month),
    supabase.from("invoices").select("amount_cents").eq("tenant_id", tenantId).eq("status", "pending"),
  ]);

  const total = rows.reduce((s, r) => s + r.amount_cents, 0);
  const pendingTotal = (pending ?? []).reduce((s, r) => s + r.amount_cents, 0);
  const byMethod = [...totalsByMethod(rows).entries()].sort((a, b) => b[1].cents - a[1].cents);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const isCurrent = month === currentMonthBR();

  return (
    <main className="flex-1 p-6 print:p-0">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <h1 className="heading text-2xl">Recebimentos</h1>
          <Link href="/dashboard/financeiro" className="link-accent text-sm">
            Voltar ao financeiro
          </Link>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/dashboard/financeiro/recebimentos?month=${prev}`} className="btn-secondary px-2 py-1" aria-label="Mês anterior">
              ←
            </Link>
            <span className="min-w-36 text-center font-medium text-ink first-letter:uppercase">{monthLabel(month)}</span>
            {isCurrent ? (
              <span className="btn-secondary px-2 py-1 opacity-40" aria-hidden>
                →
              </span>
            ) : (
              <Link href={`/dashboard/financeiro/recebimentos?month=${next}`} className="btn-secondary px-2 py-1" aria-label="Próximo mês">
                →
              </Link>
            )}
          </div>
          <div className="flex gap-2">
            <a href={`/dashboard/financeiro/recebimentos/csv?month=${month}`} className="btn-secondary px-3 py-1.5 text-sm">
              Baixar CSV
            </a>
            <PrintButton className="btn-secondary px-3 py-1.5 text-sm">Imprimir</PrintButton>
          </div>
        </div>

        <div className="hidden print:block">
          <h1 className="heading text-xl">{tenantName} — Recebimentos de {monthLabel(month)}</h1>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-2xl font-semibold text-ink">{formatCents(total)}</p>
            <p className="text-sm text-muted-soft">recebido em {monthLabel(month)}</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-semibold text-ink">{rows.length}</p>
            <p className="text-sm text-muted-soft">pagamento(s)</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-semibold text-ink">{formatCents(pendingTotal)}</p>
            <p className="text-sm text-muted-soft">ainda a receber (hoje)</p>
          </div>
        </div>

        {byMethod.length > 0 && (
          <div className="card divide-y divide-border text-sm">
            {byMethod.map(([method, t]) => (
              <div key={method} className="flex justify-between p-3">
                <span className="text-ink">
                  {methodLabel(method)} <span className="text-muted-soft">· {t.count}</span>
                </span>
                <span className="font-medium text-ink">{formatCents(t.cents)}</span>
              </div>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum pagamento neste mês"
            description="Quando você marcar cobranças como pagas, elas aparecem aqui."
          />
        ) : (
          <div className="card divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{r.patientName}</p>
                  <p className="text-xs text-muted-soft">
                    {BR_DATE_TIME.format(new Date(r.paid_at))} · {methodLabel(r.method)}
                    {r.serviceName && ` · ${r.serviceName}`}
                    {r.paid_via_link_id && " · via link"}
                    {r.package_id && " · pacote"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-ink">{formatCents(r.amount_cents)}</span>
                  <Link href={`/dashboard/financeiro/${r.id}/recibo`} className="link-accent text-xs print:hidden">
                    recibo
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
