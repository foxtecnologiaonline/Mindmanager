import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage } from "@/lib/notifications/whatsapp";
import {
  buildCancelledReply,
  buildConfirmedReply,
  buildNoMatchReply,
  buildUnrecognizedReply,
} from "@/lib/notifications/messages";
import { isNoReply, isYesReply, normalizeReply } from "@/lib/notifications/reply-matching";

/**
 * Recebe `message.received` da API pública v1 do ZapScript (resposta do
 * paciente por WhatsApp). Configure uma vez, com sua API key:
 *
 *   curl -X POST https://api.zapscript.me/public/v1/webhooks \
 *     -H "X-Api-Key: $ZAPSCRIPT_API_KEY" -H "Content-Type: application/json" \
 *     -d '{"url":"https://<seu-domínio>/api/webhooks/zapscript","events":["message.received"]}'
 *
 * A resposta traz um `secret` — isso vira ZAPSCRIPT_WEBHOOK_SECRET.
 *
 * O HMAC é sobre o corpo CRU (texto), por isso lemos com `request.text()`
 * antes de fazer JSON.parse — reserializar o objeto muda a assinatura.
 */
const MAX_PAYLOAD_AGE_MS = 5 * 60_000;

function validZapScriptSignature(secret: string, signature: string, rawBody: string) {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export async function POST(request: NextRequest) {
  const secret = process.env.ZAPSCRIPT_WEBHOOK_SECRET;
  const signature = request.headers.get("x-zapscript-signature");
  // Id único desta entrega — usado como Idempotency-Key das respostas que
  // não têm uma mudança de status no banco pra se apoiar (no-match,
  // resposta não reconhecida). Uma reentrega da mesma entrega reusa a
  // mesma key e o ZapScript não manda a mensagem de novo; uma entrega
  // nova (outra mensagem do paciente) tem delivery id diferente e envia.
  const deliveryId = request.headers.get("x-zapscript-delivery");

  if (!secret || !signature) {
    return new NextResponse(null, { status: 403 });
  }

  const rawBody = await request.text();

  if (!validZapScriptSignature(secret, signature, rawBody)) {
    return new NextResponse(null, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    event: string;
    timestamp: string;
    data: Record<string, unknown>;
  };

  // O timestamp está dentro do corpo assinado, então é confiável pra
  // detectar replay de uma entrega antiga reenviada por terceiro.
  const age = Date.now() - new Date(payload.timestamp).getTime();
  if (!Number.isFinite(age) || age > MAX_PAYLOAD_AGE_MS || age < -MAX_PAYLOAD_AGE_MS) {
    return new NextResponse("payload expirado", { status: 401 });
  }

  if (payload.event !== "message.received") {
    // message.status, transcription.completed etc — não é da nossa conta.
    return NextResponse.json({ ok: true });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ ok: true });
  }

  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey);

  const contactPhone = String(payload.data.contactPhone ?? "");
  const text = normalizeReply(String(payload.data.text ?? ""));
  const last9 = contactPhone.replace(/\D/g, "").slice(-9);

  if (!last9) {
    return NextResponse.json({ ok: true });
  }

  // Sem RLS aqui (service role) — pega os próximos agendamentos pendentes
  // de qualquer tenant e casa pelos últimos 9 dígitos do telefone.
  const { data: pending } = await supabase
    .from("appointments")
    .select("id, patient_phone, starts_at")
    .eq("status", "pending")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(200);

  const match = (pending ?? []).find(
    (a) => a.patient_phone.replace(/\D/g, "").slice(-9) === last9,
  );

  if (!match) {
    await sendWhatsAppMessage(
      contactPhone,
      buildNoMatchReply(),
      deliveryId ? `reply-no-match-${deliveryId}` : undefined,
    );
    return NextResponse.json({ ok: true });
  }

  if (isYesReply(text)) {
    // Update condicional (só se ainda pending): já é idempotente por si só
    // (uma reentrega não reprocessa nem manda a resposta de novo, porque o
    // segundo update não afeta linha nenhuma), sem precisar do delivery id.
    const { data: updated } = await supabase
      .from("appointments")
      .update({ status: "confirmed" })
      .eq("id", match.id)
      .eq("status", "pending")
      .select("id");
    if (updated && updated.length > 0) {
      await sendWhatsAppMessage(
        match.patient_phone,
        buildConfirmedReply(),
        `reply-confirm-${match.id}`,
      );
    }
  } else if (isNoReply(text)) {
    const { data: updated } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", match.id)
      .eq("status", "pending")
      .select("id");
    if (updated && updated.length > 0) {
      await sendWhatsAppMessage(
        match.patient_phone,
        buildCancelledReply(),
        `reply-cancel-${match.id}`,
      );
    }
  } else {
    await sendWhatsAppMessage(
      match.patient_phone,
      buildUnrecognizedReply(),
      deliveryId ? `reply-unrecognized-${deliveryId}` : undefined,
    );
  }

  return NextResponse.json({ ok: true });
}
