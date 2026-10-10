import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  buildRecurrenceDates,
  isValidDateStr,
  monthGridStart,
  startOfWeekMonday,
  weekdayOf,
} from "@/lib/scheduling/dates";

describe("addDays / addMonths", () => {
  it("atravessa mês e ano", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("gruda no último dia do mês de destino", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("semana e mês", () => {
  it("weekdayOf: 0 = domingo", () => {
    expect(weekdayOf("2026-10-11")).toBe(0);
    expect(weekdayOf("2026-10-12")).toBe(1);
  });

  it("startOfWeekMonday", () => {
    expect(startOfWeekMonday("2026-10-11")).toBe("2026-10-05"); // domingo
    expect(startOfWeekMonday("2026-10-12")).toBe("2026-10-12"); // segunda
  });

  it("monthGridStart começa numa segunda-feira", () => {
    expect(weekdayOf(monthGridStart("2026-10-15"))).toBe(1);
  });
});

describe("buildRecurrenceDates", () => {
  it("none devolve só a data inicial", () => {
    expect(buildRecurrenceDates("2026-10-12", "none", 5)).toEqual(["2026-10-12"]);
  });

  it("semanal e quinzenal", () => {
    expect(buildRecurrenceDates("2026-10-12", "weekly", 3)).toEqual([
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
    ]);
    expect(buildRecurrenceDates("2026-10-12", "biweekly", 2)).toEqual(["2026-10-12", "2026-10-26"]);
  });

  it("mensal não encolhe o dia depois de um mês curto", () => {
    expect(buildRecurrenceDates("2026-01-31", "monthly", 4)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });
});

describe("isValidDateStr", () => {
  it("aceita só datas reais de calendário", () => {
    expect(isValidDateStr("2026-02-28")).toBe(true);
    expect(isValidDateStr("2026-02-30")).toBe(false);
    expect(isValidDateStr("2026-2-1")).toBe(false);
    expect(isValidDateStr("")).toBe(false);
    expect(isValidDateStr(undefined)).toBe(false);
    expect(isValidDateStr("2026-10-10T00:00:00Z")).toBe(false);
  });
});
