// Data + hora no formato/fuso do produto, usada nas telas e no relatório
// CSV de recebimentos.
export const BR_DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});
