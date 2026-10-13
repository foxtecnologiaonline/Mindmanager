"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { requireCapability } from "@/lib/permissions";
import { normalizePixKey } from "@/lib/billing/pix";

const CONFIG_PATH = "/dashboard/agenda/configuracoes";

// Pix + maquininha/adquirente + o interruptor de envio automático —
// tudo numa ação só porque é um formulário só em Configurações › Recebimento.
// Continua sem processar pagamento nenhum: só formata o que a clínica já
// usa pra receber (mesma ideia do resto do módulo financeiro).
export async function updatePaymentSettings(formData: FormData) {
  const { supabase, tenantId, role } = await getTenantContext().then(async (c) => ({
    ...c,
    supabase: await createClient(),
  }));
  requireCapability(role, "settings");

  const rawPixKey = String(formData.get("pixKey") ?? "").trim();
  const pixHolderName = String(formData.get("pixHolderName") ?? "").trim();
  const pixCity = String(formData.get("pixCity") ?? "").trim();
  const acceptsCard = formData.get("acceptsCard") === "on";
  const cardInstructions = String(formData.get("cardInstructions") ?? "").trim();
  const autoSend = formData.get("autoSendPaymentWhatsapp") === "on";

  // Pix é tudo-ou-nada: ou os três campos vêm preenchidos, ou nenhum —
  // meio-preenchido geraria um código Pix inválido na hora de usar.
  const pixFilled = [rawPixKey, pixHolderName, pixCity].filter(Boolean);
  if (pixFilled.length > 0 && pixFilled.length < 3) {
    redirect(
      `${CONFIG_PATH}?error=${encodeURIComponent("Preencha chave Pix, nome e cidade juntos — ou deixe os três em branco.")}`,
    );
  }
  const pixKey = rawPixKey ? normalizePixKey(rawPixKey) : "";

  if (pixKey.length > 77 || pixHolderName.length > 60 || pixCity.length > 40) {
    redirect(`${CONFIG_PATH}?error=${encodeURIComponent("Chave Pix, nome ou cidade muito longos.")}`);
  }
  if (cardInstructions.length > 300) {
    redirect(`${CONFIG_PATH}?error=${encodeURIComponent("Texto da maquininha muito longo (máx. 300 caracteres).")}`);
  }

  const { data: saved, error } = await supabase
    .from("tenants")
    .update({
      pix_key: pixKey || null,
      pix_holder_name: pixHolderName || null,
      pix_city: pixCity || null,
      accepts_card: acceptsCard,
      card_instructions: cardInstructions || null,
      auto_send_payment_whatsapp: autoSend,
    })
    .eq("id", tenantId)
    .select("id");

  if (error || !saved?.length) {
    redirect(
      `${CONFIG_PATH}?error=${encodeURIComponent(error?.message ?? "Não foi possível salvar.")}`,
    );
  }

  revalidatePath(CONFIG_PATH);
  revalidatePath("/dashboard/financeiro");
  redirect(`${CONFIG_PATH}?success=${encodeURIComponent("Configurações de recebimento salvas.")}`);
}
