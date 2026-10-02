// "Responda 1/2" em vez de SIM/NÃO/CANCELAR: essas palavras são reservadas
// no ZapScript para opt-out de campanha (PARAR/SAIR/CANCELAR) e opt-in
// (SIM) — colidem com a resposta do paciente e disparam réplica automática
// de campanha além da nossa. 1/2 evita a colisão.
export function buildConfirmationQuestion(startsAt: Date) {
  const when = startsAt.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });

  return `Você tem uma consulta marcada para ${when}. Responda 1 para confirmar ou 2 para cancelar.`;
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

export function buildReminder24h(startsAt: Date, pending: boolean) {
  const when = startsAt.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });

  if (pending) {
    return `Lembrete: você ainda não confirmou sua consulta de amanhã, ${when}. Responda 1 para confirmar ou 2 para cancelar.`;
  }

  return `Lembrete: você tem consulta amanhã, ${when}.`;
}
