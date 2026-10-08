// Helpers de data compartilhados entre a página da agenda (navegação
// dia/semana/mês) e as ações de agendamento (série de recorrência).
// Mesma convenção usada no resto do produto: America/Sao_Paulo, sem
// horário de verão desde 2019 (-03:00 fixo) — simplificação MVP,
// produto Brasil-only.
export const BRAZIL_UTC_OFFSET = "-03:00";

export function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00${BRAZIL_UTC_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

// Soma meses preservando o dia quando possível, e grudando no último
// dia do mês de destino quando não existe (ex: 31/jan + 1 mês -> 28 ou
// 29/fev, nunca "vaza" pra março).
export function addMonths(dateStr: string, months: number) {
  const d = new Date(`${dateStr}T00:00:00${BRAZIL_UTC_OFFSET}`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return formatDate(d);
}

// 0 = domingo .. 6 = sábado (mesma convenção de working_hours.day_of_week).
export function weekdayOf(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${BRAZIL_UTC_OFFSET}`).getUTCDay();
}

export function startOfWeekMonday(dateStr: string) {
  const dow = weekdayOf(dateStr);
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  return addDays(dateStr, diffToMonday);
}

export function startOfMonth(dateStr: string) {
  return `${dateStr.slice(0, 7)}-01`;
}

// Primeira segunda-feira na grade de 42 células (6 semanas) do mês que
// contém dateStr — cobre o mês inteiro mesmo quando ele não começa numa
// segunda, preenchendo os dias do mês anterior/seguinte nas bordas.
export function monthGridStart(dateStr: string) {
  return startOfWeekMonday(startOfMonth(dateStr));
}

const BR_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
});

// Data (YYYY-MM-DD) de um timestamp ISO, no fuso do produto — não dá pra
// usar .slice(0,10) direto num ISO em UTC, viraria o dia errado perto da
// meia-noite.
export function dateOfISOBR(iso: string) {
  return BR_DATE_FORMATTER.format(new Date(iso));
}

export type Recurrence = "none" | "weekly" | "biweekly" | "monthly";

// Gera as datas de uma série recorrente a partir de startDate (inclusive).
// "none" sempre devolve só a data inicial, ignorando occurrences.
export function buildRecurrenceDates(
  startDate: string,
  recurrence: Recurrence,
  occurrences: number,
): string[] {
  if (recurrence === "none") {
    return [startDate];
  }

  const count = Math.max(1, occurrences);
  const dates = [startDate];
  for (let i = 1; i < count; i++) {
    const previous = dates[i - 1];
    dates.push(
      recurrence === "monthly"
        ? addMonths(previous, 1)
        : addDays(previous, recurrence === "weekly" ? 7 : 14),
    );
  }
  return dates;
}
