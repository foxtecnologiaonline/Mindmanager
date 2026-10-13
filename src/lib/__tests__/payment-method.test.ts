import { describe, expect, it } from "vitest";
import { methodLabel, parseMethod } from "@/lib/billing/payment-method";

describe("methodLabel", () => {
  it("traduz os 4 métodos conhecidos", () => {
    expect(methodLabel("pix")).toBe("PIX");
    expect(methodLabel("card")).toBe("Cartão");
    expect(methodLabel("cash")).toBe("Dinheiro");
    expect(methodLabel("other")).toBe("Outro");
  });

  it("devolve travessão para nulo, vazio ou valor desconhecido", () => {
    expect(methodLabel(null)).toBe("—");
    expect(methodLabel(undefined)).toBe("—");
    expect(methodLabel("")).toBe("—");
    expect(methodLabel("boleto")).toBe("—");
  });
});

describe("parseMethod", () => {
  it("aceita os 4 métodos conhecidos", () => {
    expect(parseMethod("pix", "other")).toBe("pix");
    expect(parseMethod("card", "other")).toBe("card");
  });

  it("cai no fallback para valor desconhecido, nulo ou ausente", () => {
    expect(parseMethod("boleto", "pix")).toBe("pix");
    expect(parseMethod(null, "other")).toBe("other");
  });

  it("fallback padrão é 'other' quando omitido", () => {
    expect(parseMethod("x")).toBe("other");
  });
});
