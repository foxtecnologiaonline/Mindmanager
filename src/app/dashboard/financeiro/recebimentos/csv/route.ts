import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { resolveMonth } from "@/lib/billing/period";
import { fetchReceived } from "@/lib/billing/reports";
import { centsToDecimal, toCsv } from "@/lib/billing/csv";
import { methodLabel } from "@/lib/billing/payment-method";
import { logger } from "@/lib/logger";
import { BR_DATE_TIME } from "@/lib/billing/format";

// Exporta os recebimentos do mês em CSV (abre direto no Excel/Sheets).
export async function GET(request: NextRequest) {
  const { tenantId, role } = await getTenantContext();
  if (!can(role, "finance")) {
    return new NextResponse("Sem permissão.", { status: 403 });
  }

  const month = resolveMonth(request.nextUrl.searchParams.get("month"));

  try {
    const rows = await fetchReceived(await createClient(), tenantId, month);
    const csv = toCsv([
      ["Data do pagamento", "Paciente", "Serviço", "Forma", "Valor (R$)", "Origem", "Observações"],
      ...rows.map((r) => [
        BR_DATE_TIME.format(new Date(r.paid_at)),
        r.patientName,
        r.serviceName ?? "",
        methodLabel(r.method),
        centsToDecimal(r.amount_cents),
        r.paid_via_link_id ? "Link de pagamento" : r.package_id ? "Pacote" : "Cobrança",
        r.notes ?? "",
      ]),
      [],
      ["", "", "", "Total", centsToDecimal(rows.reduce((s, r) => s + r.amount_cents, 0)), "", ""],
    ]);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="recebimentos-${month}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    logger.error("billing.csv_failed", err, { month });
    return new NextResponse("Não foi possível gerar o relatório.", { status: 500 });
  }
}
