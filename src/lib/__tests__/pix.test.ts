import { describe, expect, it } from "vitest";
import { buildPixPayload, crc16CCITT, normalizePixKey } from "@/lib/billing/pix";

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

describe("normalizePixKey", () => {
  it("e-mail em minúsculas; chave aleatória em minúsculas", () => {
    expect(normalizePixKey("  Clinica@Exemplo.COM ")).toBe("clinica@exemplo.com");
    expect(normalizePixKey("123E4567-E89B-12D3-A456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("CPF/CNPJ com máscara viram só dígitos", () => {
    expect(normalizePixKey("123.456.789-09")).toBe("12345678909");
    expect(normalizePixKey("12.345.678/0001-95")).toBe("12345678000195");
    expect(normalizePixKey("12345678000195")).toBe("12345678000195");
  });

  it("celular: +55 explícito é mantido; com máscara ganha +55", () => {
    expect(normalizePixKey("+55 (11) 91234-5678")).toBe("+5511912345678");
    expect(normalizePixKey("(11) 91234-5678")).toBe("+5511912345678");
    expect(normalizePixKey("11 91234-5678")).toBe("+5511912345678");
  });

  it("11 dígitos sem máscara segue como CPF (ambíguo)", () => {
    expect(normalizePixKey("12345678909")).toBe("12345678909");
  });

  it("o payload usa a chave normalizada", () => {
    const payload = buildPixPayload({
      pixKey: "(11) 91234-5678",
      merchantName: "X",
      merchantCity: "Y",
      amountCents: 100,
      txId: "a",
    });
    expect(payload).toContain("0114+5511912345678");
  });
});
