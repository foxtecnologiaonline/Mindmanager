import { describe, expect, it } from "vitest";
import { currentMonthBR, monthLabel, monthRange, resolveMonth, shiftMonth } from "@/lib/billing/period";
import { centsToDecimal, toCsv } from "@/lib/billing/csv";
import { totalsByMethod, type ReceivedRow } from "@/lib/billing/reports";

describe("período", () => {
  it("resolveMonth aceita só YYYY-MM válido", () => {
    expect(resolveMonth("2026-03", new Date("2026-10-10T12:00:00Z"))).toBe("2026-03");
    expect(resolveMonth("2026-13", new Date("2026-10-10T12:00:00Z"))).toBe("2026-10");
    expect(resolveMonth("abc", new Date("2026-10-10T12:00:00Z"))).toBe("2026-10");
    expect(resolveMonth(null, new Date("2026-10-10T12:00:00Z"))).toBe("2026-10");
  });

  it("mês corrente usa o fuso de Brasília (virada às 00h BRT, não UTC)", () => {
    expect(currentMonthBR(new Date("2026-11-01T01:00:00Z"))).toBe("2026-10"); // 22h de 31/out em BRT
    expect(currentMonthBR(new Date("2026-11-01T03:30:00Z"))).toBe("2026-11");
  });

  it("shiftMonth atravessa o ano", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("monthRange é [início, início do próximo)", () => {
    expect(monthRange("2026-12")).toEqual({
      start: "2026-12-01T00:00:00-03:00",
      end: "2027-01-01T00:00:00-03:00",
    });
  });

  it("monthLabel em pt-BR", () => {
    expect(monthLabel("2026-10")).toMatch(/outubro de 2026/i);
  });
});

describe("csv", () => {
  it("separa por ';', escapa aspas/quebras e começa com BOM", () => {
    const csv = toCsv([["a", 'b;"c"'], ["x\ny", "z"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('a;"b;""c"""');
    expect(csv).toContain('"x\ny";z');
  });

  it("neutraliza injeção de fórmula", () => {
    const csv = toCsv([["=HYPERLINK(\"http://x\")", "+1", "-2", "@a", "normal"]]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain(";'+1;'-2;'@a;normal");
  });

  it("centsToDecimal usa vírgula", () => {
    expect(centsToDecimal(15050)).toBe("150,50");
    expect(centsToDecimal(5)).toBe("0,05");
  });
});

describe("totalsByMethod", () => {
  const row = (method: string | null, cents: number): ReceivedRow => ({
    id: "x", amount_cents: cents, method, paid_at: "", notes: null,
    paid_via_link_id: null, package_id: null, patientName: "", serviceName: null,
  });

  it("agrupa por método e trata nulo como 'other'", () => {
    const t = totalsByMethod([row("pix", 100), row("pix", 50), row(null, 10), row("cash", 5)]);
    expect(t.get("pix")).toEqual({ count: 2, cents: 150 });
    expect(t.get("other")).toEqual({ count: 1, cents: 10 });
    expect(t.get("cash")).toEqual({ count: 1, cents: 5 });
  });
});
