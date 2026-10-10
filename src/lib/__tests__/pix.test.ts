import { describe, expect, it } from "vitest";
import { buildPixPayload, crc16CCITT } from "@/lib/billing/pix";

describe("crc16CCITT", () => {
  it("bate com o vetor de teste padrão CRC-16/CCITT-FALSE", () => {
    expect(crc16CCITT("123456789")).toBe("29B1");
  });
});

describe("buildPixPayload", () => {
  const base = {
    pixKey: "clinica@exemplo.com",
    merchantName: "Clínica São José",
    merchantCity: "São Paulo",
    amountCents: 15050,
    txId: "abc-123",
  };

  it("termina com CRC válido sobre o próprio conteúdo", () => {
    const payload = buildPixPayload(base);
    const body = payload.slice(0, -4);
    expect(body.endsWith("6304")).toBe(true);
    expect(payload.slice(-4)).toBe(crc16CCITT(body));
  });

  it("inclui chave, valor com 2 casas e país/moeda", () => {
    const payload = buildPixPayload(base);
    expect(payload).toContain("BR.GOV.BCB.PIX");
    expect(payload).toContain("0119clinica@exemplo.com");
    expect(payload).toContain("5406150.50");
    expect(payload).toContain("5303986");
    expect(payload).toContain("5802BR");
  });

  it("remove acentos de nome e cidade", () => {
    const payload = buildPixPayload(base);
    expect(payload).toContain("Clinica Sao Jose");
    expect(payload).toContain("Sao Paulo");
    expect(payload).not.toMatch(/[^\x20-\x7e]/);
  });

  it("limita nome (25) e cidade (15) e limpa o txid", () => {
    const payload = buildPixPayload({
      ...base,
      merchantName: "N".repeat(80),
      merchantCity: "C".repeat(80),
      txId: "id com espaço/!",
    });
    expect(payload).toContain(`5925${"N".repeat(25)}`);
    expect(payload).toContain(`6015${"C".repeat(15)}`);
    expect(payload).toContain("0511idcomespaco");
  });

  it("usa fallback quando nome/cidade ficam vazios após sanitizar", () => {
    const payload = buildPixPayload({ ...base, merchantName: "!!!", merchantCity: "???" });
    expect(payload).toContain("5902NA");
    expect(payload).toContain("6002NA");
  });
});
