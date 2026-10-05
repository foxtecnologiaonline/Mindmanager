const ZAPSCRIPT_API_KEY = process.env.ZAPSCRIPT_API_KEY;
const ZAPSCRIPT_NUMBER_ID = process.env.ZAPSCRIPT_NUMBER_ID;
const ZAPSCRIPT_BASE_URL = process.env.ZAPSCRIPT_BASE_URL || "https://api.zapscript.me";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // ex: "whatsapp:+14155238886"

export type WhatsAppSenderOverride = { apiKey: string; numberId: string };

/**
 * Envia uma mensagem de WhatsApp. Ordem de preferência: `senderOverride`
 * (número próprio da clínica, ZapScript — ver resolveWhatsappSender) →
 * ZapScript da plataforma (env vars, número compartilhado) → Twilio →
 * log (se nada estiver configurado — não quebra o fluxo de agendamento,
 * a reserva é sempre mais importante que o aviso).
 *
 * `idempotencyKey`: evite reenvio duplicado em retry do seu lado (ex:
 * `confirm-<appointmentId>`). Só tem efeito nos caminhos ZapScript
 * (nativo da API); é ignorado no Twilio.
 */
export async function sendWhatsAppMessage(
  to: string,
  body: string,
  idempotencyKey?: string,
  senderOverride?: WhatsAppSenderOverride,
) {
  if (senderOverride) {
    return sendViaZapScript(to, body, idempotencyKey, senderOverride);
  }

  if (ZAPSCRIPT_API_KEY && ZAPSCRIPT_NUMBER_ID) {
    return sendViaZapScript(to, body, idempotencyKey);
  }

  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM) {
    return sendViaTwilio(to, body);
  }

  console.log(`[whatsapp:not-configured] para ${to}: ${body}`);
  return { sent: false as const };
}

async function sendViaZapScript(
  to: string,
  body: string,
  idempotencyKey?: string,
  override?: WhatsAppSenderOverride,
) {
  const digits = to.replace(/\D/g, "");
  const apiKey = override?.apiKey ?? ZAPSCRIPT_API_KEY!;
  const numberId = override?.numberId ?? ZAPSCRIPT_NUMBER_ID;

  try {
    const response = await fetch(`${ZAPSCRIPT_BASE_URL}/public/v1/messages`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        numberId,
        to: digits,
        body,
      }),
      // O POST só responde depois de tentar enviar de verdade (até 3
      // tentativas, 15s cada) — a doc do ZapScript recomenda timeout de
      // cliente de pelo menos 60s.
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`[zapscript:error] ${response.status} para ${to} — ${errorBody}`);
      return { sent: false as const };
    }

    const data = (await response.json()) as { status?: string };
    return { sent: data.status === "sent" };
  } catch (err) {
    console.error("[zapscript:error]", err);
    return { sent: false as const };
  }
}

async function sendViaTwilio(to: string, body: string) {
  const digits = to.replace(/\D/g, "");
  const toAddress = `whatsapp:+${digits}`;

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: TWILIO_WHATSAPP_FROM!,
          To: toAddress,
          Body: body,
        }),
      },
    );

    if (!response.ok) {
      console.error(`[whatsapp:error] ${response.status} para ${to}`);
      return { sent: false as const };
    }

    return { sent: true as const };
  } catch (err) {
    console.error("[whatsapp:error]", err);
    return { sent: false as const };
  }
}
