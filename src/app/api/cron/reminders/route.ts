import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { sendWhatsAppMessage, type WhatsAppSenderOverride } from "@/lib/notifications/whatsapp";
import { buildFollowup, buildReminder24h } from "@/lib/notifications/messages";
import { resolveWhatsappSender } from "@/lib/notifications/sender-config";

/**
 * Lembrete de consulta (~24h antes) e mensagem pós-consulta com a pesquisa
 * de satisfação (NPS). Chamada por um scheduler externo — Vercel Cron
 * (diário, vercel.json) e/ou o workflow .github/workflows/reminders.yml
 * (de hora em hora). Pode rodar com qualquer frequência: é idempotente.
 *
 * Protegida por CRON_SECRET (server-to-server, sem cookie) e usa a service
 * role key para ler/atualizar appointments de todos os tenants.
 *
 * Confiabilidade:
 *  - cada envio é "reivindicado" antes (UPDATE condicional do contador de
 *    tentativas): duas execuções simultâneas nunca mandam a mesma mensagem;
 *  - falha de envio deixa o registro elegível para a próxima execução, até
 *    MAX_ATTEMPTS tentativas — depois disso desiste (não fica em loop).
 */
const MAX_ATTEMPTS = 3;
const BATCH = 200;
const HOUR = 60 * 60 * 1000;

type Claimable = "reminder" | "followup";

async function claim(supabase: SupabaseClient, id: string, kind: Claimable, previousAttempts: number) {
  const attemptsColumn = kind === "reminder" ? "reminder_attempts" : "followup_attempts";
  const sentColumn = kind === "reminder" ? "reminder_sent_at" : "followup_sent_at";

  const { data } = await supabase
    .from("appointments")
    .update({ [attemptsColumn]: previousAttempts + 1 })
    .eq("id", id)
    .eq(attemptsColumn, previousAttempts)
    .is(sentColumn, null)
    .select("id");

  return (data?.length ?? 0) === 1;
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
  }

  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey);
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const now = Date.now();

  // O número de envio é por clínica; resolve uma vez por clínica na execução.
  const senders = new Map<string, WhatsAppSenderOverride | undefined>();
  async function senderFor(tenantId: string) {
    if (!senders.has(tenantId)) senders.set(tenantId, await resolveWhatsappSender(tenantId));
    return senders.get(tenantId);
  }

  // ------------------------------------------------------------ lembretes
  // Janela cobre 24h inteiras (o cron diário não pode deixar buraco); com
  // execuções mais frequentes o lembrete sai logo que a consulta entra nela.
  const { data: reminders, error: reminderError } = await supabase
    .from("appointments")
    .select("id, tenant_id, patient_phone, starts_at, status, reminder_attempts")
    .in("status", ["confirmed", "pending"])
    .is("reminder_sent_at", null)
    .lt("reminder_attempts", MAX_ATTEMPTS)
    .gte("starts_at", new Date(now + 1 * HOUR).toISOString())
    .lte("starts_at", new Date(now + 25 * HOUR).toISOString())
    .order("starts_at")
    .limit(BATCH);

  if (reminderError) {
    logger.error("cron.reminders.query_failed", reminderError);
    return NextResponse.json({ error: reminderError.message }, { status: 500 });
  }

  let remindersSent = 0;
  for (const appt of reminders ?? []) {
    if (!(await claim(supabase, appt.id, "reminder", appt.reminder_attempts))) continue;

    const result = await sendWhatsAppMessage(
      appt.patient_phone,
      buildReminder24h(new Date(appt.starts_at), appt.status === "pending"),
      `reminder-${appt.id}`,
      await senderFor(appt.tenant_id),
    );

    if (result.sent) {
      await supabase
        .from("appointments")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", appt.id);
      remindersSent += 1;
    } else {
      logger.warn("cron.reminders.send_failed", { appointmentId: appt.id, attempt: appt.reminder_attempts + 1 });
    }
  }

  // ----------------------------------------------------------- pós-consulta
  const { data: followups, error: followupError } = await supabase
    .from("appointments")
    .select("id, tenant_id, patient_phone, nps_token, followup_attempts, tenants ( name )")
    .eq("status", "completed")
    .is("followup_sent_at", null)
    .lt("followup_attempts", MAX_ATTEMPTS)
    .lte("ends_at", new Date(now - 1 * HOUR).toISOString())
    .gte("ends_at", new Date(now - 72 * HOUR).toISOString())
    .order("ends_at")
    .limit(BATCH);

  if (followupError) {
    // Não derruba os lembretes já enviados; migration 0018 pode não estar aplicada.
    logger.error("cron.followups.query_failed", followupError);
  }

  let followupsSent = 0;
  for (const appt of followups ?? []) {
    if (!(await claim(supabase, appt.id, "followup", appt.followup_attempts))) continue;

    const tenant = Array.isArray(appt.tenants) ? appt.tenants[0] : appt.tenants;
    const result = await sendWhatsAppMessage(
      appt.patient_phone,
      buildFollowup(tenant?.name ?? "clínica", `${origin}/nps/${appt.nps_token}`),
      `followup-${appt.id}`,
      await senderFor(appt.tenant_id),
    );

    if (result.sent) {
      await supabase
        .from("appointments")
        .update({ followup_sent_at: new Date().toISOString() })
        .eq("id", appt.id);
      followupsSent += 1;
    } else {
      logger.warn("cron.followups.send_failed", { appointmentId: appt.id, attempt: appt.followup_attempts + 1 });
    }
  }

  return NextResponse.json({
    reminders: { checked: reminders?.length ?? 0, sent: remindersSent },
    followups: { checked: followups?.length ?? 0, sent: followupsSent },
  });
}
