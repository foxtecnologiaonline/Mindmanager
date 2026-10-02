import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage } from "@/lib/notifications/whatsapp";
import { buildReminder24h } from "@/lib/notifications/messages";

/**
 * Envia lembrete de consulta ~24h antes do horário marcado. Pensada para
 * ser chamada uma vez por dia por um scheduler externo (Vercel Cron via
 * vercel.json, ou um pg_cron/Edge Function do Supabase) — não há
 * agendador embutido no Next.js.
 *
 * Protegida por CRON_SECRET (não usa cookie de sessão, é chamada
 * server-to-server) e usa a service role key para ler/atualizar
 * appointments de todos os tenants, contornando a RLS por tenant que
 * existe para o acesso de usuários finais.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey,
  );

  const windowStart = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("id, patient_phone, starts_at, status")
    .in("status", ["confirmed", "pending"])
    .is("reminder_sent_at", null)
    .gte("starts_at", windowStart)
    .lte("starts_at", windowEnd);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  for (const appt of appointments ?? []) {
    const result = await sendWhatsAppMessage(
      appt.patient_phone,
      buildReminder24h(new Date(appt.starts_at), appt.status === "pending"),
      `reminder-${appt.id}`,
    );

    if (result.sent) {
      await supabase
        .from("appointments")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", appt.id);
      sent += 1;
    }
  }

  return NextResponse.json({ checked: appointments?.length ?? 0, sent });
}
