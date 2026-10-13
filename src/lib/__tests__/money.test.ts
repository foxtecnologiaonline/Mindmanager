import { describe, expect, it } from "vitest";
import { formatCents } from "@/lib/billing/money";

// Intl.NumberFormat usa um espaço fino (U+00A0, não o espaço comum) entre
// "R$" e o valor — normaliza antes de comparar, senão o teste quebra por
// um caractere invisível em vez de um erro de formatação de verdade.
const normalize = (s: string) => s.replace(/\s/g, " ");

describe("formatCents", () => {
  it("formata centavos como moeda em pt-BR", () => {
    expect(normalize(formatCents(15050))).toBe("R$ 150,50");
    expect(normalize(formatCents(0))).toBe("R$ 0,00");
    expect(normalize(formatCents(5))).toBe("R$ 0,05");
  });

  it("agrupa milhar com ponto", () => {
    expect(normalize(formatCents(123456789))).toBe("R$ 1.234.567,89");
  });
});
