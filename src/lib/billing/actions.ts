"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenantId } from "@/lib/tenant";
import { parseMethod } from "@/lib/billing/payment-method";
import { sendWhatsAppMessage } from "@/lib/notifications/whatsapp";
import { resolveWhatsappSender } from "@/lib/notifications/sender-config";
import { buildPaymentLinkMessage } from "@/lib/notifications/messages";
import { siteUrl } from "@/lib/site-url";

const MAX_AMOUNT_CENTS = 100_000_000; // R$ 1.000.000,00 — acima disso é erro de digitação

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

// Cobrança avulsa ou de um agendamento: se a clínica ligou o envio
// automático (Configurações › Recebimento) e tem Pix ou maquininha
// configurados, um trigger no banco (migration 0020) já empacotou essa
// cobrança num link de pagamento sozinho — aqui só falta mandar o
// WhatsApp pro paciente com ele.
async function autoSendNewInvoice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceId: string,
  patientId: string,
  tenantId: string,
) {
  const { data: link } = await supabase
    .from("payment_links")
    .select("id, amount_cents")
    .eq("tenant_id", tenantId)
    .contains("invoice_ids", [invoiceId])
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!link) return;

  const [{ data: patient }, { data: tenant }] = await Promise.all([
    supabase.from("patients").select("phone").eq("id", patientId).single(),
    supabase.from("tenants").select("name").eq("id", tenantId).single(),
  ]);
  if (!patient?.phone) return;

  const senderOverride = await resolveWhatsappSender(tenantId);
  await sendWhatsAppMessage(
    patient.phone,
    buildPaymentLinkMessage(tenant?.name ?? "Clínica", link.amount_cents, `${await siteUrl()}/pagar/${link.id}`),
    `payment-link-${link.id}`,
    senderOverride,
  );
}

// Cobrança manual, fora do fluxo de agendamento (ex: cobrar um pacote de
// sessões, ou um atendimento que não passou pela agenda).
export async function createManualInvoice(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();

  const patientId = String(formData.get("patientId") ?? "");
  const amountReais = String(formData.get("amount") ?? "").replace(",", ".");
  const amountCents = Math.round(Number(amountReais) * 100);
  const notes = String(formData.get("notes") ?? "").trim();

  if (!patientId || !Number.isFinite(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
    redirect(
      `/dashboard/financeiro?error=${encodeURIComponent("Selecione o paciente e um valor válido.")}`,
    );
  }

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      tenant_id: tenantId,
      patient_id: patientId,
      amount_cents: amountCents,
      notes: notes || null,
    })
    .select("id")
    .single();

  if (error || !invoice) {
    redirect(`/dashboard/financeiro?error=${encodeURIComponent(error?.message ?? "Não foi possível criar a cobrança.")}`);
  }

  await autoSendNewInvoice(supabase, invoice.id, patientId, tenantId);

  revalidatePath("/dashboard/financeiro");
  redirect(`/dashboard/financeiro?success=${encodeURIComponent("Cobrança criada.")}`);
}

// Registro manual de recebimento: a clínica recebeu por fora (PIX
// próprio, maquininha, dinheiro) — o sistema só marca como pago e guarda
// como, pra emitir o recibo. Não processa pagamento nenhum.
export async function markInvoicePaid(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));
  const method = parseMethod(formData.get("method"), "other");

  const { data: updated, error } = await supabase
    .from("invoices")
    .update({ status: "paid", method, paid_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  revalidatePath("/dashboard/financeiro");

  if (error || !updated?.length) {
    redirect(
      `/dashboard/financeiro?error=${encodeURIComponent(
        error?.message ?? "Essa cobrança não está mais pendente.",
      )}`,
    );
  }

  redirect(
    `/dashboard/financeiro?success=${encodeURIComponent("Pagamento registrado.")}&undoInvoiceId=${id}`,
  );
}

export async function undoInvoicePayment(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));

  await supabase
    .from("invoices")
    .update({ status: "pending", method: null, paid_at: null, paid_via_link_id: null })
    .eq("id", id)
    .eq("status", "paid");

  revalidatePath("/dashboard/financeiro");
  redirect(`/dashboard/financeiro?success=${encodeURIComponent("Pagamento desfeito.")}`);
}

export async function cancelInvoice(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));

  // Só cancela o que ainda está pendente — cobrança paga precisa
  // primeiro ter o pagamento desfeito (evita sumir com dinheiro recebido).
  await supabase.from("invoices").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");

  revalidatePath("/dashboard/financeiro");
  redirect(`/dashboard/financeiro?success=${encodeURIComponent("Cobrança cancelada.")}`);
}
