import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { can, requireCapability } from "@/lib/permissions";

describe("can", () => {
  it("financeiro: admin e recepção, não profissional", () => {
    expect(can("admin", "finance")).toBe(true);
    expect(can("recepcao", "finance")).toBe(true);
    expect(can("profissional", "finance")).toBe(false);
  });

  it("prontuário: admin e profissional, não recepção", () => {
    expect(can("profissional", "clinical")).toBe(true);
    expect(can("recepcao", "clinical")).toBe(false);
  });

  it("configurações e equipe: só admin", () => {
    for (const cap of ["settings", "team", "audit"] as const) {
      expect(can("admin", cap)).toBe(true);
      expect(can("profissional", cap)).toBe(false);
      expect(can("recepcao", cap)).toBe(false);
    }
  });

  it("papel desconhecido ou vazio não pode nada", () => {
    expect(can("hacker", "finance")).toBe(false);
    expect(can(null, "clinical")).toBe(false);
  });
});

describe("requireCapability", () => {
  it("redireciona ao dashboard sem permissão e passa quando tem", () => {
    expect(() => requireCapability("recepcao", "clinical")).toThrow(/REDIRECT:\/dashboard\?error=/);
    expect(() => requireCapability("admin", "clinical")).not.toThrow();
  });
});
