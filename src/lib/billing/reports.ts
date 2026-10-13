import type { SupabaseClient } from "@supabase/supabase-js";
import { monthRange } from "@/lib/billing/period";

export type ReceivedRow = {
  id: string;
  amount_cents: number;
  method: string | null;
  paid_at: string;
  notes: string | null;
  paid_via_link_id: string | null;
  package_id: string | null;
  patientName: string;
  serviceName: string | null;
};

const PAGE = 1000;

// Cobranças pagas no mês (por data de pagamento), mais recentes primeiro.
// Pagina de 1000 em 1000 (limite do PostgREST) até acabar.
export async function fetchReceived(
  supabase: SupabaseClient,
  tenantId: string,
  month: string,
): Promise<ReceivedRow[]> {
  const { start, end } = monthRange(month);
  const rows: ReceivedRow[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("invoices")
      .select(
        "id, amount_cents, method, paid_at, notes, paid_via_link_id, package_id, patients ( full_name ), appointments ( service_types ( name ) )",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "paid")
      .gte("paid_at", start)
      .lt("paid_at", end)
      .order("paid_at", { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(error.message);

    for (const inv of data ?? []) {
      const patient = Array.isArray(inv.patients) ? inv.patients[0] : inv.patients;
      const appt = Array.isArray(inv.appointments) ? inv.appointments[0] : inv.appointments;
      const service = appt
        ? Array.isArray(appt.service_types)
          ? appt.service_types[0]
          : appt.service_types
        : null;
      rows.push({
        id: inv.id,
        amount_cents: inv.amount_cents,
        method: inv.method,
        paid_at: inv.paid_at,
        notes: inv.notes,
        paid_via_link_id: inv.paid_via_link_id,
        package_id: inv.package_id,
        patientName: patient?.full_name ?? "Paciente removido",
        serviceName: service?.name ?? null,
      });
    }

    if ((data?.length ?? 0) < PAGE) break;
  }

  return rows;
}

export function totalsByMethod(rows: ReceivedRow[]): Map<string, { count: number; cents: number }> {
  const map = new Map<string, { count: number; cents: number }>();
  for (const r of rows) {
    const key = r.method ?? "other";
    const cur = map.get(key) ?? { count: 0, cents: 0 };
    map.set(key, { count: cur.count + 1, cents: cur.cents + r.amount_cents });
  }
  return map;
}

// Soma recebida no mês (só valores, paginado) — o dashboard financeiro não
// pode somar uma resposta truncada em 1000 linhas.
export async function sumReceived(
  supabase: SupabaseClient,
  tenantId: string,
  month: string,
): Promise<number> {
  const { start, end } = monthRange(month);
  let total = 0;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("invoices")
      .select("amount_cents")
      .eq("tenant_id", tenantId)
      .eq("status", "paid")
      .gte("paid_at", start)
      .lt("paid_at", end)
      .order("id")
      .range(from, from + PAGE - 1);

    if (error) throw new Error(error.message);
    total += (data ?? []).reduce((sum, r) => sum + r.amount_cents, 0);
    if ((data?.length ?? 0) < PAGE) break;
  }

  return total;
}
