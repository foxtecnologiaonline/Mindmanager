import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { WhatsAppSenderOverride } from "@/lib/notifications/whatsapp";

/**
 * Resolve se um tenant manda WhatsApp pelo número próprio (ZapScript) ou
 * pelo compartilhado da plataforma (undefined → sendWhatsAppMessage usa
 * as env vars globais). Sempre via service role: whatsapp_api_key tem
 * select revogado pra `authenticated` (migration 0006) — só a service
 * role lê essa coluna, nunca o client logado da própria clínica.
 */
export async function resolveWhatsappSender(
  tenantId: string,
): Promise<WhatsAppSenderOverride | undefined> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return undefined;
  }

  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey);
  const { data } = await supabase
    .from("tenants")
    .select("whatsapp_mode, whatsapp_api_key, whatsapp_number_id")
    .eq("id", tenantId)
    .single();

  if (data?.whatsapp_mode === "own" && data.whatsapp_api_key && data.whatsapp_number_id) {
    return { apiKey: data.whatsapp_api_key, numberId: data.whatsapp_number_id };
  }

  return undefined;
}
