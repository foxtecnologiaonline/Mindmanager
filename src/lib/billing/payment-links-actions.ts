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

// Cria um link de pagamento pra uma ou mais cobranças pendentes do
// mesmo paciente — junta, por exemplo, várias sessões acumuladas num
// acerto só. O valor é sempre recalculado a partir das invoices reais
// no banco (nunca aceita o total vindo do formulário), pra não dar pra
// forjar um valor menor no link.
export async function createPaymentLink(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();

  const patientId = String(formData.get("patientId") ?? "");
  const invoiceIds = formData.getAll("invoiceIds").map(String).filter(Boolean);

  if (!patientId || invoiceIds.length === 0) {
    redirect(`/dashboard/financeiro?error=${encodeURIComponent("Selecione ao menos uma cobrança.")}`);
  }

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, amount_cents")
    .eq("tenant_id", tenantId)
    .eq("patient_id", patientId)
    .eq("status", "pending")
    .in("id", invoiceIds);

  const amountCents = (invoices ?? []).reduce((sum, inv) => sum + inv.amount_cents, 0);
  const confirmedIds = (invoices ?? []).map((inv) => inv.id);

  if (confirmedIds.length === 0) {
    redirect(
      `/dashboard/financeiro?error=${encodeURIComponent("Nenhuma dessas cobranças está mais pendente.")}`,
    );
  }

  const { data: link, error } = await supabase
    .from("payment_links")
    .insert({
      tenant_id: tenantId,
      patient_id: patientId,
      invoice_ids: confirmedIds,
      amount_cents: amountCents,
    })
    .select("id")
    .single();

  if (error) {
    redirect(`/dashboard/financeiro?error=${encodeURIComponent(error.message)}`);
  }

  // "Gerar link" é um clique explícito da equipe — se o envio automático
  // estiver ligado (Configurações › Recebimento) e o paciente tiver
  // telefone, manda na hora em vez de só deixar o botão "copiar link"
  // pra equipe repassar por fora.
  const sentViaWhatsapp = await trySendPaymentLink(supabase, tenantId, patientId, link!.id, amountCents);

  revalidatePath("/dashboard/financeiro");
  redirect(
    `/dashboard/financeiro?view=links&linkCreated=${link!.id}${sentViaWhatsapp ? "&linkSent=1" : ""}`,
  );
}

async function trySendPaymentLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  patientId: string,
  linkId: string,
  amountCents: number,
): Promise<boolean> {
  const [{ data: tenant }, { data: patient }] = await Promise.all([
    supabase.from("tenants").select("name, auto_send_payment_whatsapp").eq("id", tenantId).single(),
    supabase.from("patients").select("phone").eq("id", patientId).single(),
  ]);

  if (!tenant?.auto_send_payment_whatsapp || !patient?.phone) return false;

  const senderOverride = await resolveWhatsappSender(tenantId);
  const url = `${await siteUrl()}/pagar/${linkId}`;
  const result = await sendWhatsAppMessage(
    patient.phone,
    buildPaymentLinkMessage(tenant.name ?? "Clínica", amountCents, url),
    `payment-link-${linkId}`,
    senderOverride,
  );
  return result.sent;
}

// Confirmação continua manual, do lado da equipe — a página pública do
// link (/pagar/[id]) nunca marca nada como pago por conta própria.
export async function confirmPaymentLinkReceived(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));
  const method = parseMethod(formData.get("method"), "pix");

  const { data: link } = await supabase
    .from("payment_links")
    .select("invoice_ids, status")
    .eq("id", id)
    .single();

  if (!link || link.status !== "open") {
    redirect(
      `/dashboard/financeiro?view=links&error=${encodeURIComponent("Esse link não está mais aberto.")}`,
    );
  }

  // Só revalida invoices que ainda estão pendentes — uma cobrança do
  // link pode ter sido cancelada depois de criado (ex: consulta
  // desmarcada), e confirmar o link não deve reviver essa cobrança.
  // paid_via_link_id marca QUAIS cobranças este link pagou, pra desfazer
  // depois só o que foi ele.
  const paidAt = new Date().toISOString();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "paid", method, paid_at: paidAt, paid_via_link_id: id })
    .eq("status", "pending")
    .in("id", link.invoice_ids);
  if (error) {
    redirect(`/dashboard/financeiro?view=links&error=${encodeURIComponent(error.message)}`);
  }
  await supabase.from("payment_links").update({ status: "paid", paid_at: paidAt }).eq("id", id).eq("status", "open");

  revalidatePath("/dashboard/financeiro");
  redirect(
    `/dashboard/financeiro?view=links&success=${encodeURIComponent("Pagamento do link confirmado.")}&undoLinkId=${id}`,
  );
}

export async function undoPaymentLinkConfirmation(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));

  const { data: link } = await supabase
    .from("payment_links")
    .select("invoice_ids, status")
    .eq("id", id)
    .single();

  if (link && link.status === "paid") {
    // Só reabre as cobranças que ESTE link pagou — as que já estavam
    // pagas antes (ou foram pagas por outra via) ficam como estão.
    await supabase
      .from("invoices")
      .update({ status: "pending", method: null, paid_at: null, paid_via_link_id: null })
      .eq("status", "paid")
      .eq("paid_via_link_id", id);
    await supabase.from("payment_links").update({ status: "open", paid_at: null }).eq("id", id);
  }

  revalidatePath("/dashboard/financeiro");
  redirect(`/dashboard/financeiro?view=links&success=${encodeURIComponent("Confirmação desfeita.")}`);
}

export async function cancelPaymentLink(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));

  await supabase.from("payment_links").update({ status: "cancelled" }).eq("id", id).eq("status", "open");

  revalidatePath("/dashboard/financeiro");
  redirect(`/dashboard/financeiro?view=links&success=${encodeURIComponent("Link cancelado.")}`);
}
