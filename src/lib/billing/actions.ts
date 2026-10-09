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

// Cobrança manual, fora do fluxo de agendamento (ex: cobrar um pacote de
// sessões, ou um atendimento que não passou pela agenda).
export async function createManualInvoice(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();

  const patientId = String(formData.get("patientId") ?? "");
  const amountReais = String(formData.get("amount") ?? "").replace(",", ".");
  const amountCents = Math.round(Number(amountReais) * 100);
  const notes = String(formData.get("notes") ?? "").trim();

  if (!patientId || !Number.isFinite(amountCents) || amountCents <= 0) {
    redirect(
      `/dashboard/financeiro?error=${encodeURIComponent("Selecione o paciente e um valor válido.")}`,
    );
  }

  const { error } = await supabase.from("invoices").insert({
    tenant_id: tenantId,
    patient_id: patientId,
    amount_cents: amountCents,
    notes: notes || null,
  });

  if (error) {
    redirect(`/dashboard/financeiro?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/financeiro");
  redirect(`/dashboard/financeiro?success=${encodeURIComponent("Cobrança criada.")}`);
}

// Registro manual de recebimento: a clínica recebeu por fora (PIX
// próprio, maquininha, dinheiro) — o sistema só marca como pago e guarda
// como, pra emitir o recibo. Não processa pagamento nenhum.
export async function markInvoicePaid(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));
  const method = String(formData.get("method") ?? "other");

  const { error } = await supabase
    .from("invoices")
    .update({ status: "paid", method, paid_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/dashboard/financeiro");

  if (error) {
    redirect(`/dashboard/financeiro?error=${encodeURIComponent(error.message)}`);
  }

  redirect(
    `/dashboard/financeiro?success=${encodeURIComponent("Pagamento registrado.")}&undoInvoiceId=${id}`,
  );
}

export async function undoInvoicePayment(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));

  await supabase.from("invoices").update({ status: "pending", method: null, paid_at: null }).eq("id", id);

  revalidatePath("/dashboard/financeiro");
  redirect(`/dashboard/financeiro?success=${encodeURIComponent("Pagamento desfeito.")}`);
}

export async function cancelInvoice(formData: FormData) {
  const { supabase } = await requireTenant();
  const id = String(formData.get("id"));

  await supabase.from("invoices").update({ status: "cancelled" }).eq("id", id);

  revalidatePath("/dashboard/financeiro");
  redirect(`/dashboard/financeiro?success=${encodeURIComponent("Cobrança cancelada.")}`);
}
