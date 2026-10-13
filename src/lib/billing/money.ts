// Formatação de valor em reais a partir de centavos (como os valores são
// guardados no banco) — repetida em 5 páginas antes de ser movida pra cá.
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
