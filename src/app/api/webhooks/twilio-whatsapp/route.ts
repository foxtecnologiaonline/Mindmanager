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
 * Recebe a resposta SIM/NÃO do paciente via WhatsApp (webhook de inbound
 * message do Twilio). Configure no console do Twilio, em "A message comes
 * in", a URL exata desta rota (sem query string) — a assinatura é
 * calculada em cima da URL configurada, então ela precisa bater
 * caractere por caractere com o que o Twilio está assinando.
 *
 * Sem TWILIO_AUTH_TOKEN configurado, a rota recusa tudo (403): não dá
 * para validar que a requisição realmente veio do Twilio, e aceitar sem
 * validar deixaria qualquer um cancelar consultas de terceiros só
 * sabendo o telefone do paciente.
 */
function validTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
) {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

function emptyTwiml() {
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get("x-twilio-signature");

  if (!authToken || !signature) {
    return new NextResponse(null, { status: 403 });
  }

  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    params[key] = String(value);
  }

  const url = new URL(request.url);
  const fullUrl = `${url.origin}${url.pathname}`;

  if (!validTwilioSignature(authToken, signature, fullUrl, params)) {
    return new NextResponse(null, { status: 403 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return emptyTwiml();
  }

  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey);

  const body = normalizeReply(params["Body"] ?? "");
  const from = params["From"] ?? ""; // "whatsapp:+5511999999999"
  const fromDigits = from.replace(/\D/g, "");
  const last9 = fromDigits.slice(-9);

  if (!last9) {
    return emptyTwiml();
  }

  // Sem RLS aqui (service role) — pega os próximos agendamentos pendentes
  // de qualquer tenant e casa pelos últimos 9 dígitos do telefone, que
  // absorve variações de +55/DDI entre o que o paciente digitou no
  // formulário e o que o WhatsApp manda no webhook.
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
    await sendWhatsAppMessage(from.replace("whatsapp:", ""), buildNoMatchReply());
    return emptyTwiml();
  }

  if (isYesReply(body)) {
    // Update condicional (só se ainda pending): torna o handler idempotente
    // mesmo sem tabela de dedupe de entrega — uma reentrega do Twilio não
    // reprocessa nem manda a resposta de novo.
    const { data: updated } = await supabase
      .from("appointments")
      .update({ status: "confirmed" })
      .eq("id", match.id)
      .eq("status", "pending")
      .select("id");
    if (updated && updated.length > 0) {
      await sendWhatsAppMessage(match.patient_phone, buildConfirmedReply());
    }
  } else if (isNoReply(body)) {
    const { data: updated } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", match.id)
      .eq("status", "pending")
      .select("id");
    if (updated && updated.length > 0) {
      await sendWhatsAppMessage(match.patient_phone, buildCancelledReply());
    }
  } else {
    await sendWhatsAppMessage(match.patient_phone, buildUnrecognizedReply());
  }

  return emptyTwiml();
}
