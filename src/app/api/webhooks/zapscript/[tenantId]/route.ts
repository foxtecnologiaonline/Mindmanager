import { type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { handleZapscriptWebhook } from "@/lib/notifications/zapscript-webhook";
import { resolveWhatsappSender } from "@/lib/notifications/sender-config";

/**
 * Webhook do número PRÓPRIO de uma clínica (registrado automaticamente
 * por connectOwnWhatsapp em src/lib/integrations/whatsapp-actions.ts).
 * Cada tenant tem sua própria conta ZapScript e seu próprio secret —
 * por isso a URL carrega o tenantId: é o que deixa a gente saber qual
 * secret usar pra validar a assinatura antes mesmo de abrir o payload.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return handleZapscriptWebhook(request, { getSecret: async () => null, tenantId });
  }

  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey);

  return handleZapscriptWebhook(request, {
    tenantId,
    senderOverride: await resolveWhatsappSender(tenantId),
    getSecret: async () => {
      const { data } = await supabase
        .from("tenants")
        .select("whatsapp_webhook_secret")
        .eq("id", tenantId)
        .single();
      return data?.whatsapp_webhook_secret ?? null;
    },
  });
}
