import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReminder24h } from "@/lib/notifications/messages";

// A janela do cron (src/app/api/cron/reminders/route.ts) cobre
// [agora+1h, agora+25h] para suportar execuções horárias — uma consulta
// pode cair nela sendo hoje mesmo, não só amanhã. O texto precisa
// acompanhar isso.
describe("buildReminder24h", () => {
  beforeEach(() => {
    // Meio-dia de BRT (15:00 UTC) num dia fixo, para "hoje"/"amanhã" serem
    // determinísticos independente do fuso da máquina que roda o teste.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("diz 'hoje' quando a consulta é no mesmo dia (BRT)", () => {
    const startsAt = new Date("2026-10-13T20:00:00Z"); // 17h BRT, mesmo dia
    expect(buildReminder24h(startsAt, false)).toContain("consulta hoje,");
    expect(buildReminder24h(startsAt, true)).toContain("consulta de hoje,");
  });

  it("diz 'amanhã' quando a consulta é no dia seguinte (BRT)", () => {
    const startsAt = new Date("2026-10-14T20:00:00Z");
    expect(buildReminder24h(startsAt, false)).toContain("consulta amanhã,");
  });

  it("usa a data por extenso quando não é hoje nem amanhã", () => {
    const startsAt = new Date("2026-10-20T20:00:00Z");
    const msg = buildReminder24h(startsAt, false);
    expect(msg).toContain("no dia 20/10/2026");
    expect(msg).not.toMatch(/\bamanhã\b/);
    expect(msg).not.toMatch(/\bhoje\b/);
  });

  it("perto da meia-noite BRT, 'hoje' e 'amanhã' seguem o fuso de Brasília, não UTC", () => {
    // 21h30 BRT de 13/out já é 14/out em UTC.
    vi.setSystemTime(new Date("2026-10-14T00:30:00Z"));
    const laterToday = new Date("2026-10-14T02:00:00Z"); // 23h BRT, ainda 13/out
    expect(buildReminder24h(laterToday, false)).toContain("consulta hoje,");
  });
});
