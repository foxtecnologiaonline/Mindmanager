"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenantId } from "@/lib/tenant";

async function requireTenant() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tenantId = await requireTenantId(supabase, user.id);

  return { supabase, tenantId };
}

// Pacote pago antecipado: registra o pacote E já cria a cobrança
// correspondente como paga (o dinheiro já entrou na hora da venda do
// pacote) — garante recibo e acompanhamento num lugar só.
export async function createPackage(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();

  const patientId = String(formData.get("patientId") ?? "");
  const serviceTypeId = String(formData.get("serviceTypeId") ?? "");
  const sessionsTotal = Number(formData.get("sessionsTotal"));
  const amountReais = String(formData.get("amount") ?? "").replace(",", ".");
  const amountCents = Math.round(Number(amountReais) * 100);
  const methodParam = String(formData.get("method") ?? "pix");
  const method = ["pix", "card", "cash", "other"].includes(methodParam) ? methodParam : "pix";

  if (
    !patientId ||
    !Number.isInteger(sessionsTotal) ||
    sessionsTotal <= 0 ||
    sessionsTotal > 200 ||
    !Number.isFinite(amountCents) ||
    amountCents <= 0 ||
    amountCents > 100_000_000
  ) {
    redirect(
      `/dashboard/financeiro/pacotes?error=${encodeURIComponent(
        "Selecione o paciente e preencha número de sessões e valor corretamente.",
      )}`,
    );
  }

  const { data: pkg, error } = await supabase
    .from("session_packages")
    .insert({
      tenant_id: tenantId,
      patient_id: patientId,
      service_type_id: serviceTypeId || null,
      sessions_total: sessionsTotal,
      amount_cents: amountCents,
    })
    .select("id")
    .single();

  if (error) {
    redirect(`/dashboard/financeiro/pacotes?error=${encodeURIComponent(error.message)}`);
  }

  const { error: invoiceError } = await supabase.from("invoices").insert({
    tenant_id: tenantId,
    patient_id: patientId,
    package_id: pkg!.id,
    amount_cents: amountCents,
    status: "paid",
    method,
    paid_at: new Date().toISOString(),
    notes: `Pacote de ${sessionsTotal} sessões`,
  });

  if (invoiceError) {
    // Sem a cobrança paga o pacote ficaria sem recibo nem rastro de
    // pagamento — desfaz o pacote em vez de deixar o registro pela metade.
    await supabase.from("session_packages").delete().eq("id", pkg!.id);
    redirect(`/dashboard/financeiro/pacotes?error=${encodeURIComponent(invoiceError.message)}`);
  }

  revalidatePath("/dashboard/financeiro/pacotes");
  redirect(`/dashboard/financeiro/pacotes?success=${encodeURIComponent("Pacote registrado.")}`);
}

// Dá baixa em uma sessão do pacote (o atendimento aconteceu) — por
// agora é um clique manual, não ligado automaticamente ao agendamento
// na agenda (evita arriscar a lógica de booking já em uso só pra essa
// integração).
export async function registerPackageSession(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));

  const { data: pkg } = await supabase
    .from("session_packages")
    .select("sessions_total, sessions_used, status")
    .eq("id", id)
    .single();

  if (pkg && pkg.status === "active" && pkg.sessions_used < pkg.sessions_total) {
    const sessionsUsed = pkg.sessions_used + 1;
    // .eq("sessions_used", ...) = concorrência otimista: dois cliques
    // simultâneos não gravam o mesmo valor (um deles vira no-op).
    await supabase
      .from("session_packages")
      .update({
        sessions_used: sessionsUsed,
        status: sessionsUsed >= pkg.sessions_total ? "completed" : "active",
      })
      .eq("id", id)
      .eq("sessions_used", pkg.sessions_used);
  }

  revalidatePath("/dashboard/financeiro/pacotes");
  redirect(`/dashboard/financeiro/pacotes?success=${encodeURIComponent("Sessão registrada.")}`);
}

export async function undoPackageSession(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));

  const { data: pkg } = await supabase
    .from("session_packages")
    .select("sessions_used, status")
    .eq("id", id)
    .single();

  if (pkg && pkg.status !== "cancelled" && pkg.sessions_used > 0) {
    await supabase
      .from("session_packages")
      .update({ sessions_used: pkg.sessions_used - 1, status: "active" })
      .eq("id", id)
      .eq("sessions_used", pkg.sessions_used);
  }

  revalidatePath("/dashboard/financeiro/pacotes");
  redirect(`/dashboard/financeiro/pacotes?success=${encodeURIComponent("Sessão desfeita.")}`);
}

export async function cancelPackage(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));

  await supabase.from("session_packages").update({ status: "cancelled" }).eq("id", id);

  revalidatePath("/dashboard/financeiro/pacotes");
  redirect(`/dashboard/financeiro/pacotes?success=${encodeURIComponent("Pacote cancelado.")}`);
}
