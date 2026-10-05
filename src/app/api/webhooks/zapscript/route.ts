import type { NextRequest } from "next/server";
import { handleZapscriptWebhook } from "@/lib/notifications/zapscript-webhook";

/**
 * Webhook do número COMPARTILHADO da plataforma (`message.received` da
 * API pública v1 do ZapScript). Configure uma vez, com a API key da
 * conta ZapScript da própria plataforma:
 *
 *   curl -X POST https://api.zapscript.me/public/v1/webhooks \
 *     -H "X-Api-Key: $ZAPSCRIPT_API_KEY" -H "Content-Type: application/json" \
 *     -d '{"url":"https://<seu-domínio>/api/webhooks/zapscript","events":["message.received"]}'
 *
 * A resposta traz um `secret` — isso vira ZAPSCRIPT_WEBHOOK_SECRET.
 *
 * Clínicas com número PRÓPRIO usam uma rota dedicada:
 * /api/webhooks/zapscript/[tenantId] (ver src/lib/integrations/whatsapp-actions.ts).
 */
export async function POST(request: NextRequest) {
  return handleZapscriptWebhook(request, {
    getSecret: async () => process.env.ZAPSCRIPT_WEBHOOK_SECRET ?? null,
  });
}
