import { addDays, dateOfISOBR, todayBR } from "@/lib/scheduling/dates";
import { formatCents } from "@/lib/billing/money";

// "Responda 1/2" em vez de SIM/NÃO/CANCELAR: essas palavras são reservadas
// no ZapScript para opt-out de campanha (PARAR/SAIR/CANCELAR) e opt-in
// (SIM) — colidem com a resposta do paciente e disparam réplica automática
// de campanha além da nossa. 1/2 evita a colisão.
//
// paymentUrl: quando a consulta gerou cobrança e a clínica ligou o envio
// automático (Configurações › Recebimento), o link de pagamento entra na
// MESMA mensagem em vez de uma segunda — evita mandar duas mensagens de
// WhatsApp pra mesma consulta (ver lib/billing/auto-send.ts).
export function buildConfirmationQuestion(startsAt: Date, paymentUrl?: string | null) {
  const when = startsAt.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });

  const base = `Você tem uma consulta marcada para ${when}. Responda 1 para confirmar ou 2 para cancelar.`;
  return paymentUrl ? `${base}\n\nPara pagar antecipado: ${paymentUrl}` : base;
}

export function buildConfirmedReply() {
  return "Consulta confirmada! Te esperamos.";
}

export function buildCancelledReply() {
  return "Tudo bem, consulta cancelada. Se quiser remarcar, é só falar com a clínica.";
}

export function buildUnrecognizedReply() {
  return 'Não entendi sua resposta. Responda apenas "1" para confirmar ou "2" para cancelar a consulta.';
}

export function buildNoMatchReply() {
  return "Não encontramos uma consulta pendente de confirmação com esse número. Se precisar de ajuda, fale com a clínica.";
}

// "amanhã" só quando a consulta é mesmo no dia seguinte (fuso de Brasília).
// Antes disso a janela do cron era fixa em [23h,25h] e a consulta sempre
// caía amanhã; desde que a janela passou a cobrir [1h,25h] (lembrete.cron
// pode rodar de hora em hora — ver route.ts), uma consulta marcada para
// daqui a poucas horas também entra na janela e precisa de um texto
// diferente ("hoje"), senão o paciente recebe um lembrete errado.
function relativeDayLabel(startsAt: Date): string {
  const target = dateOfISOBR(startsAt.toISOString());
  const today = todayBR();
  if (target === today) return "hoje";
  if (target === addDays(today, 1)) return "amanhã";
  return `no dia ${startsAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
}

export function buildReminder24h(startsAt: Date, pending: boolean) {
  const when = startsAt.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
  const day = relativeDayLabel(startsAt);

  if (pending) {
    return `Lembrete: você ainda não confirmou sua consulta de ${day}, ${when}. Responda 1 para confirmar ou 2 para cancelar.`;
  }

  return `Lembrete: você tem consulta ${day}, ${when}.`;
}

export function buildFollowup(clinicName: string, npsUrl: string) {
  return `Obrigado por ter vindo à ${clinicName}! Como foi seu atendimento? Leva 10 segundos: ${npsUrl}`;
}

// Cobrança avulsa ou link de acerto (várias sessões juntas) — a página
// /pagar/<id> já mostra Pix e/ou maquininha, conforme o que a clínica
// configurou, então a mensagem não precisa repetir qual método está
// disponível.
export function buildPaymentLinkMessage(clinicName: string, amountCents: number, url: string) {
  return `${clinicName}: cobrança de ${formatCents(amountCents)}. Para pagar: ${url}`;
}
