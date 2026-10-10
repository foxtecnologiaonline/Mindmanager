// Mês de referência dos relatórios financeiros, sempre em America/Sao_Paulo
// (-03:00, sem horário de verão desde 2019 — mesma convenção do resto do app).
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function currentMonthBR(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now).slice(0, 7);
}

export function resolveMonth(param: string | null | undefined, now = new Date()): string {
  return param && MONTH_RE.test(param) ? param : currentMonthBR(now);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// Intervalo [início, fim) do mês, pronto para .gte()/.lt() em timestamptz.
export function monthRange(month: string): { start: string; end: string } {
  return {
    start: `${month}-01T00:00:00-03:00`,
    end: `${shiftMonth(month, 1)}-01T00:00:00-03:00`,
  };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
