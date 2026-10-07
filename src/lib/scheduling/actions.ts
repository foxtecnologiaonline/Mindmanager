"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppMessage } from "@/lib/notifications/whatsapp";
import { isValidBrazilPhone } from "@/lib/scheduling/validation";
import { buildConfirmationQuestion } from "@/lib/notifications/messages";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveWhatsappSender } from "@/lib/notifications/sender-config";
import { ensureTenantId } from "@/lib/tenant";

// Deslocamento fixo usado para combinar data+hora vindos de formulários da
// equipe com o timezone assumido pelas funções SQL (America/Sao_Paulo, sem
// horário de verão desde 2019). Simplificação MVP: produto Brasil-only.
const BRAZIL_UTC_OFFSET = "-03:00";

async function requireProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profileQuery = () =>
    supabase
      .from("profiles")
      .select("id, tenant_id, role, full_name, tenants ( slug )")
      .eq("id", user.id)
      .single();

  let { data: profile } = await profileQuery();

  if (!profile?.tenant_id) {
    // Rede de segurança: desde a migration 0007 isso não deveria faltar
    // nunca (o tenant nasce no trigger de signup), mas resolve aqui
    // mesmo em vez de redirecionar.
    await ensureTenantId(supabase, user.id, profile?.full_name ?? null);
    ({ data: profile } = await profileQuery());
  }

  const tenant = Array.isArray(profile!.tenants)
    ? profile!.tenants[0]
    : profile!.tenants;

  return { supabase, profile: profile!, tenantSlug: tenant?.slug as string };
}

export async function createServiceType(formData: FormData) {
  const { supabase, profile } = await requireProfile();

  const name = String(formData.get("name") ?? "").trim();
  const durationMinutes = Number(formData.get("durationMinutes"));
  const priceReais = formData.get("price");
  const priceCents =
    priceReais && String(priceReais).trim() !== ""
      ? Math.round(Number(priceReais) * 100)
      : null;

  if (!name || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    redirect(
      "/dashboard/agenda/configuracoes?error=" +
        encodeURIComponent("Preencha nome e duração corretamente."),
    );
  }

  const { error } = await supabase.from("service_types").insert({
    tenant_id: profile.tenant_id,
    name,
    duration_minutes: durationMinutes,
    price_cents: priceCents,
  });

  if (error) {
    redirect(
      `/dashboard/agenda/configuracoes?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath("/dashboard/agenda/configuracoes");
}

export async function deactivateServiceType(formData: FormData) {
  const { supabase } = await requireProfile();
  const id = String(formData.get("id"));

  await supabase.from("service_types").update({ active: false }).eq("id", id);

  revalidatePath("/dashboard/agenda/configuracoes");
}

export async function createWorkingHour(formData: FormData) {
  const { supabase } = await requireProfile();

  const professionalId = String(formData.get("professionalId"));
  const dayOfWeek = Number(formData.get("dayOfWeek"));
  const startTime = String(formData.get("startTime"));
  const endTime = String(formData.get("endTime"));

  if (!professionalId || !startTime || !endTime || startTime >= endTime) {
    redirect(
      "/dashboard/agenda/configuracoes?error=" +
        encodeURIComponent("Horário inválido: o início deve ser antes do fim."),
    );
  }

  const { error } = await supabase.from("working_hours").insert({
    professional_id: professionalId,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
  });

  if (error) {
    redirect(
      `/dashboard/agenda/configuracoes?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath("/dashboard/agenda/configuracoes");
}

export async function deleteWorkingHour(formData: FormData) {
  const { supabase } = await requireProfile();
  const id = String(formData.get("id"));

  await supabase.from("working_hours").delete().eq("id", id);

  revalidatePath("/dashboard/agenda/configuracoes");
}

export async function createManualAppointment(formData: FormData) {
  const { supabase, profile, tenantSlug } = await requireProfile();

  const professionalId = String(formData.get("professionalId"));
  const serviceTypeId = String(formData.get("serviceTypeId"));
  const date = String(formData.get("date"));
  const time = String(formData.get("time"));
  const patientName = String(formData.get("patientName") ?? "").trim();
  const patientPhone = String(formData.get("patientPhone") ?? "").trim();
  const patientEmail = String(formData.get("patientEmail") ?? "").trim();

  if (!isValidBrazilPhone(patientPhone)) {
    redirect(
      `/dashboard/agenda?error=${encodeURIComponent(
        "Telefone inválido. Informe DDD + número (ex: 11 91234-5678).",
      )}&date=${date}`,
    );
  }

  const startsAt = new Date(`${date}T${time}:00${BRAZIL_UTC_OFFSET}`);

  const { data, error } = await supabase
    .rpc("book_appointment", {
      p_tenant_slug: tenantSlug,
      p_professional_id: professionalId,
      p_service_type_id: serviceTypeId,
      p_patient_name: patientName,
      p_patient_phone: patientPhone,
      p_patient_email: patientEmail || null,
      p_starts_at: startsAt.toISOString(),
    })
    .single();

  if (error) {
    redirect(`/dashboard/agenda?error=${encodeURIComponent(error.message)}&date=${date}`);
  }

  const appointment = data as { id: string };
  const senderOverride = await resolveWhatsappSender(profile.tenant_id);
  await sendWhatsAppMessage(
    patientPhone,
    buildConfirmationQuestion(startsAt),
    `confirm-question-${appointment.id}`,
    senderOverride,
  );

  revalidatePath("/dashboard/agenda");
}

export async function cancelAppointment(formData: FormData) {
  const { supabase } = await requireProfile();
  const id = String(formData.get("id"));

  await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);

  revalidatePath("/dashboard/agenda");
}

// Fallback manual: equipe confirma por telefone/presencialmente, ou
// nenhum provedor de WhatsApp (ZapScript/Twilio) está configurado neste
// ambiente.
export async function confirmAppointmentManually(formData: FormData) {
  const { supabase } = await requireProfile();
  const id = String(formData.get("id"));

  await supabase.from("appointments").update({ status: "confirmed" }).eq("id", id);

  revalidatePath("/dashboard/agenda");
}

export async function getAvailableSlots(
  professionalId: string,
  serviceTypeId: string,
  day: string,
) {
  const ip = await getClientIp();
  // Generoso (o usuário legítimo chama isso a cada troca de data/serviço
  // na tela pública): só pra impedir scraping/DoS trivial no endpoint.
  const allowed = await checkRateLimit(`slots:${ip}`, 30, 60);
  if (!allowed) {
    return { slots: [] as string[], error: "Muitas tentativas. Aguarde um minuto." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_professional_id: professionalId,
    p_service_type_id: serviceTypeId,
    p_day: day,
  });

  if (error) {
    return { slots: [] as string[], error: error.message };
  }

  return { slots: (data ?? []) as string[], error: null };
}

export async function bookPublicAppointment(input: {
  tenantSlug: string;
  professionalId: string;
  serviceTypeId: string;
  patientName: string;
  patientPhone: string;
  patientEmail: string;
  startsAt: string;
}) {
  const ip = await getClientIp();
  // Mais estrito que o de slots: isso grava no banco e dispara WhatsApp,
  // então cada tentativa tem custo real (e é o alvo óbvio de abuso —
  // lotar a agenda de terceiros ou gerar custo de envio de mensagem).
  const allowed = await checkRateLimit(`book:${ip}`, 5, 60);
  if (!allowed) {
    return { success: false as const, error: "Muitas tentativas. Aguarde um minuto e tente de novo." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("book_appointment", {
      p_tenant_slug: input.tenantSlug,
      p_professional_id: input.professionalId,
      p_service_type_id: input.serviceTypeId,
      p_patient_name: input.patientName,
      p_patient_phone: input.patientPhone,
      p_patient_email: input.patientEmail || null,
      p_starts_at: input.startsAt,
    })
    .single();

  if (error) {
    return { success: false as const, error: error.message };
  }

  const appointment = data as { id: string; starts_at: string; tenant_id: string };
  const senderOverride = await resolveWhatsappSender(appointment.tenant_id);

  await sendWhatsAppMessage(
    input.patientPhone,
    buildConfirmationQuestion(new Date(appointment.starts_at)),
    `confirm-question-${appointment.id}`,
    senderOverride,
  );

  return { success: true as const, error: null };
}
