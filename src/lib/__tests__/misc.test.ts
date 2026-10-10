import { describe, expect, it } from "vitest";
import { isValidBrazilPhone } from "@/lib/scheduling/validation";
import { stripDiacritics } from "@/lib/text";
import { slugify } from "@/lib/slug";
import { isNoReply, isYesReply, normalizeReply } from "@/lib/notifications/reply-matching";
import { safeNextPath } from "@/lib/safe-redirect";
import { isCronAuthorized } from "@/lib/cron-auth";

describe("isValidBrazilPhone", () => {
  it("aceita DDD + 8/9 dígitos, com ou sem +55", () => {
    expect(isValidBrazilPhone("(11) 91234-5678")).toBe(true);
    expect(isValidBrazilPhone("11 1234-5678")).toBe(true);
    expect(isValidBrazilPhone("+55 11 91234-5678")).toBe(true);
  });

  it("recusa curto, longo e vazio", () => {
    expect(isValidBrazilPhone("1234-5678")).toBe(false);
    expect(isValidBrazilPhone("1191234567890")).toBe(false);
    expect(isValidBrazilPhone("")).toBe(false);
  });
});

describe("texto", () => {
  it("stripDiacritics", () => {
    expect(stripDiacritics("Ação São José")).toBe("Acao Sao Jose");
  });

  it("slugify", () => {
    expect(slugify("Clínica São José")).toBe("clinica-sao-jose");
    expect(slugify("!!!")).toBe("clinica");
  });
});

describe("respostas do WhatsApp", () => {
  it("1/sim confirma; 2/não cancela", () => {
    expect(isYesReply(normalizeReply(" 1 "))).toBe(true);
    expect(isYesReply(normalizeReply("SIM"))).toBe(true);
    expect(isNoReply(normalizeReply("Não"))).toBe(true);
    expect(isNoReply(normalizeReply("2"))).toBe(true);
    expect(isYesReply(normalizeReply("talvez"))).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("aceita caminhos internos", () => {
    expect(safeNextPath("/dashboard/agenda?x=1")).toBe("/dashboard/agenda?x=1");
    expect(safeNextPath("/redefinir-senha")).toBe("/redefinir-senha");
  });

  it("recusa redirect aberto", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "/\n/evil.com", "/\t/evil.com"]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});

describe("isCronAuthorized", () => {
  it("exige o segredo exato", () => {
    expect(isCronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isCronAuthorized("Bearer outro!", "s3cret")).toBe(false);
    expect(isCronAuthorized("Bearer s3cret", undefined)).toBe(false);
    expect(isCronAuthorized(null, "s3cret")).toBe(false);
  });
});
