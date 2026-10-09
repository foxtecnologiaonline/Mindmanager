"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenantId } from "@/lib/tenant";

const METHODS = ["pix", "card", "cash", "other"] as const;
const MAX_AMOUNT_CENTS = 100_000_000; // R$ 1.000.000,00 — acima disso é erro de digitação

function parseMethod(value: FormDataEntryValue | null, fallback: (typeof METHODS)[number]) {
  const v = String(value ?? "");
  return (METHODS as readonly string[]).includes(v) ? v : fallback;
}

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

  if (!patientId || !Number.isFinite(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
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
    .update({ status: "pending", method: null, paid_at: null })
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

// Dados usados só pra formatar o código Pix Copia e Cola (lib/billing/pix.ts)
// — a clínica informa a própria chave, nada é validado contra o Banco
// Central nem enviado a nenhum provedor.
export async function updatePixSettings(formData: FormData) {
  const { supabase, tenantId } = await requireTenant();

  const pixKey = String(formData.get("pixKey") ?? "").trim();
  const pixHolderName = String(formData.get("pixHolderName") ?? "").trim();
  const pixCity = String(formData.get("pixCity") ?? "").trim();

  if (!pixKey || !pixHolderName || !pixCity || pixKey.length > 77 || pixHolderName.length > 60 || pixCity.length > 40) {
    redirect(
      `/dashboard/financeiro?error=${encodeURIComponent("Preencha chave Pix, nome e cidade.")}`,
    );
  }

  const { data: saved, error: saveError } = await supabase
    .from("tenants")
    .update({ pix_key: pixKey, pix_holder_name: pixHolderName, pix_city: pixCity })
    .eq("id", tenantId)
    .select("id");

  if (saveError || !saved?.length) {
    redirect(
      `/dashboard/financeiro?error=${encodeURIComponent(
        saveError?.message ?? "Não foi possível salvar os dados do Pix.",
      )}`,
    );
  }

  revalidatePath("/dashboard/financeiro");
  redirect(`/dashboard/financeiro?success=${encodeURIComponent("Dados do Pix salvos.")}`);
}
