export function buildConfirmationQuestion(startsAt: Date) {
  const when = startsAt.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });

  return `Você tem uma consulta marcada para ${when}. Confirma? Responda SIM para confirmar ou NÃO para cancelar.`;
}

export function buildConfirmedReply() {
  return "Consulta confirmada! Te esperamos.";
}

export function buildCancelledReply() {
  return "Tudo bem, consulta cancelada. Se quiser remarcar, é só falar com a clínica.";
}

export function buildUnrecognizedReply() {
  return 'Não entendi sua resposta. Responda apenas "SIM" para confirmar ou "NÃO" para cancelar a consulta.';
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
    return `Lembrete: você ainda não confirmou sua consulta de amanhã, ${when}. Responda SIM para confirmar ou NÃO para cancelar.`;
  }

  return `Lembrete: você tem consulta amanhã, ${when}.`;
}
