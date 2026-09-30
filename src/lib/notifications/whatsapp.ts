const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // ex: "whatsapp:+14155238886"

/**
 * Envia uma mensagem de WhatsApp via Twilio. Se as credenciais não
 * estiverem configuradas, apenas loga (não quebra o fluxo de agendamento
 * — a reserva é sempre mais importante que o aviso).
 */
export async function sendWhatsAppMessage(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    console.log(`[whatsapp:not-configured] para ${to}: ${body}`);
    return { sent: false as const };
  }

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
          From: TWILIO_WHATSAPP_FROM,
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
