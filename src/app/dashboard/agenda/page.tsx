import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PatientPicker } from "@/components/patient-picker";
import {
  cancelAppointment,
  confirmAppointmentManually,
  createManualAppointment,
  restoreAppointmentStatus,
} from "@/lib/scheduling/actions";
import {
  addDays,
  addMonths,
  BRAZIL_UTC_OFFSET,
  dateOfISOBR,
  isValidDateStr,
  todayBR,
  monthGridStart,
  startOfWeekMonday,
} from "@/lib/scheduling/dates";

export const metadata: Metadata = { title: "Agenda" };

// Instanciado uma vez: criar um Intl.DateTimeFormat por chamada pesa
// quando a grade tem muitos agendamentos (cada bloco chama isso 2x).
const BR_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function minutesOfDayBR(iso: string) {
  const [h, m] = BR_TIME_FORMATTER.format(new Date(iso)).split(":");
  return Number(h) * 60 + Number(m);
}

function minutesFromTimeString(t: string) {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

function timeStringFromMinutes(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Agrupa agendamentos que se sobrepõem em "clusters" e distribui cada um
// numa coluna dentro do cluster (como agendas do tipo Google Calendar),
// em vez de empilhar tudo na largura cheia — sem isso, dois agendamentos
// no mesmo horário (ex: forçado manualmente fora do expediente) ficam
// visualmente um por cima do outro.
function layoutOverlapLanes(items: { id: string; startMin: number; endMin: number }[]) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin);
  const result = new Map<string, { col: number; cols: number }>();

  let colEndMin: number[] = [];
  const colOf = new Map<string, number>();
  let clusterEnd = -Infinity;
  let clusterCols = 0;
  let clusterItemIds: string[] = [];

  function flushCluster() {
    for (const id of clusterItemIds) {
      result.set(id, { col: colOf.get(id)!, cols: clusterCols });
    }
    clusterItemIds = [];
    clusterCols = 0;
  }

  for (const item of sorted) {
    if (item.startMin >= clusterEnd) {
      flushCluster();
      colEndMin = [];
      clusterEnd = item.endMin;
    } else {
      clusterEnd = Math.max(clusterEnd, item.endMin);
    }

    let col = colEndMin.findIndex((end) => end <= item.startMin);
    if (col === -1) {
      col = colEndMin.length;
      colEndMin.push(item.endMin);
    } else {
      colEndMin[col] = item.endMin;
    }

    colOf.set(item.id, col);
    clusterCols = Math.max(clusterCols, colEndMin.length);
    clusterItemIds.push(item.id);
  }
  flushCluster();

  return result;
}

const PX_PER_MIN = 1.4;
const DEFAULT_START_MIN = 7 * 60;
const DEFAULT_END_MIN = 20 * 60;
const SLOT_MINUTES = 30;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Concluído",
  no_show: "Faltou",
};

// Nunca só a cor diferencia o status (WCAG 1.4.1): cada um também tem um
// glifo próprio, usado junto do texto/legenda.
const STATUS_GLYPH: Record<string, string> = {
  pending: "●",
  confirmed: "✓",
  cancelled: "✕",
  completed: "✔",
  no_show: "—",
};

// Azul = o paciente respondeu "1" (confirmou) no WhatsApp; vermelho = o
// paciente respondeu "2" (cancelou) ou a equipe cancelou manualmente;
// amarelo = ainda sem resposta. Concluído/faltou não tem relação com a
// confirmação, por isso ficam neutros (cinza).
const STATUS_CLASS: Record<string, string> = {
  pending: "border-2 border-amber-300 bg-amber-50 text-amber-900",
  confirmed: "border-2 border-blue-400 bg-blue-50 text-blue-900",
  cancelled: "border-2 border-red-300 bg-red-50 text-red-800 line-through opacity-80",
  completed: "border-2 border-dashed border-border bg-paper text-muted-soft",
  no_show: "border-2 border-dashed border-border bg-paper text-muted-soft",
};

const STATUS_DOT_BG: Record<string, string> = {
  pending: "bg-amber-400",
  confirmed: "bg-blue-500",
  cancelled: "bg-red-500",
  completed: "bg-border",
  no_show: "bg-border",
};

type View = "day" | "week" | "month";

function resolveView(value: string | undefined): View {
  return value === "week" || value === "month" ? value : "day";
}

function ViewTabs({ view, date }: { view: View; date: string }) {
  const tabs: { key: View; label: string }[] = [
    { key: "day", label: "Diário" },
    { key: "week", label: "Semanal" },
    { key: "month", label: "Mensal" },
  ];

  return (
    <div className="inline-flex gap-1 rounded-lg border border-border bg-paper p-1 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/dashboard/agenda?view=${tab.key}&date=${date}`}
          className={`rounded-md px-3 py-1.5 font-medium ${
            view === tab.key ? "bg-accent text-white" : "text-muted hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      <LegendDot status="pending" colorClass="border-amber-300 bg-amber-50" label="Pendente — sem resposta" />
      <LegendDot status="confirmed" colorClass="border-blue-400 bg-blue-50" label="Confirmado — paciente disse sim" />
      <LegendDot status="cancelled" colorClass="border-red-300 bg-red-50" label="Cancelado — paciente disse não" />
      <LegendDot status="completed" colorClass="border-dashed border-border bg-paper" label="Concluído/faltou" />
    </div>
  );
}

function LegendDot({
  status,
  colorClass,
  label,
}: {
  status: string;
  colorClass: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden="true"
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 text-[8px] leading-none ${colorClass}`}
      >
        {STATUS_GLYPH[status]}
      </span>
      {label}
    </span>
  );
}

function AgendaHeader({
  view,
  date,
  undoAppointment,
}: {
  view: View;
  date: string;
  undoAppointment?: { id: string; status: string };
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading text-2xl">Agenda</h1>
        <ViewTabs view={view} date={date} />
      </div>
      <Suspense fallback={null}>
        <Toast
          undo={
            undoAppointment
              ? {
                  action: restoreAppointmentStatus,
                  fields: { id: undoAppointment.id, status: undoAppointment.status, date },
                  label: "Desfazer",
                }
              : undefined
          }
        />
      </Suspense>
    </>
  );
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    view?: string;
    error?: string;
    profId?: string;
    time?: string;
    patientId?: string;
    undoApptId?: string;
    undoStatus?: string;
  }>;
}) {
  const {
    date: dateParam,
    view: viewParam,
    profId,
    time: prefillTime,
    patientId,
    undoApptId,
    undoStatus,
  } = await searchParams;
  const view = resolveView(viewParam);
  const date = isValidDateStr(dateParam) ? dateParam : todayBR();

  const { tenantId } = await getTenantContext();
  const supabase = await createClient();

  if (view === "month") {
    const gridStart = monthGridStart(date);
    const gridDates = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const gridEnd = addDays(gridStart, 42);
    const currentMonthPrefix = date.slice(0, 7);

    const { data: monthAppointments } = await supabase
      .from("appointments")
      .select("id, starts_at, status")
      .eq("tenant_id", tenantId)
      .gte("starts_at", `${gridStart}T00:00:00${BRAZIL_UTC_OFFSET}`)
      .lt("starts_at", `${gridEnd}T00:00:00${BRAZIL_UTC_OFFSET}`);

    const countsByDate = new Map<string, Record<string, number>>();
    for (const appt of monthAppointments ?? []) {
      const d = dateOfISOBR(appt.starts_at);
      const counts = countsByDate.get(d) ?? {};
      counts[appt.status] = (counts[appt.status] ?? 0) + 1;
      countsByDate.set(d, counts);
    }

    const monthLabel = new Date(`${date}T00:00:00${BRAZIL_UTC_OFFSET}`).toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });

    return (
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <AgendaHeader view={view} date={date} />

          <div className="flex items-center justify-between text-sm">
            <Link href={`/dashboard/agenda?view=month&date=${addMonths(date, -1)}`} className="link-accent">
              &larr; mês anterior
            </Link>
            <p className="text-center font-medium text-ink capitalize">{monthLabel}</p>
            <Link href={`/dashboard/agenda?view=month&date=${addMonths(date, 1)}`} className="link-accent">
              próximo mês &rarr;
            </Link>
          </div>

          <StatusLegend />

          <div className="card overflow-x-auto p-4">
            <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-medium text-muted-soft">
              {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {gridDates.map((d) => {
                const inMonth = d.slice(0, 7) === currentMonthPrefix;
                const counts = countsByDate.get(d) ?? {};
                const statusEntries = Object.entries(counts);
                const total = statusEntries.reduce((sum, [, n]) => sum + n, 0);
                const dots = statusEntries.flatMap(([status, n]) =>
                  Array.from({ length: n }, () => status),
                );

                return (
                  <Link
                    key={d}
                    href={`/dashboard/agenda?view=day&date=${d}`}
                    className={`flex min-h-[64px] flex-col gap-1 rounded-md border border-border p-1.5 text-left text-[11px] hover:bg-accent-soft ${
                      inMonth ? "bg-paper" : "bg-transparent text-muted-soft opacity-50"
                    }`}
                  >
                    <span className="font-medium">{Number(d.slice(8, 10))}</span>
                    {total > 0 && (
                      <div className="flex flex-wrap items-center gap-0.5">
                        {dots.slice(0, 4).map((status, i) => (
                          <span
                            key={i}
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_BG[status]}`}
                          />
                        ))}
                        {total > 4 && <span className="text-[9px] text-muted-soft">+{total - 4}</span>}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (view === "week") {
    const weekStart = startOfWeekMonday(date);
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const weekEnd = addDays(weekStart, 7);

    const { data: weekAppointments } = await supabase
      .from("appointments")
      .select("id, patient_name, starts_at, status")
      .eq("tenant_id", tenantId)
      .gte("starts_at", `${weekStart}T00:00:00${BRAZIL_UTC_OFFSET}`)
      .lt("starts_at", `${weekEnd}T00:00:00${BRAZIL_UTC_OFFSET}`)
      .order("starts_at");

    const byDate = new Map<string, typeof weekAppointments>();
    for (const d of weekDates) byDate.set(d, []);
    for (const appt of weekAppointments ?? []) {
      const d = dateOfISOBR(appt.starts_at);
      const list = byDate.get(d) ?? [];
      list.push(appt);
      byDate.set(d, list);
    }

    return (
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <AgendaHeader view={view} date={date} />

          <div className="flex items-center justify-between text-sm">
            <Link href={`/dashboard/agenda?view=week&date=${addDays(date, -7)}`} className="link-accent">
              &larr; semana anterior
            </Link>
            <p className="text-center font-medium text-ink">
              {new Date(`${weekStart}T00:00:00${BRAZIL_UTC_OFFSET}`).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
              })}{" "}
              –{" "}
              {new Date(`${addDays(weekStart, 6)}T00:00:00${BRAZIL_UTC_OFFSET}`).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
              })}
            </p>
            <Link href={`/dashboard/agenda?view=week&date=${addDays(date, 7)}`} className="link-accent">
              próxima semana &rarr;
            </Link>
          </div>

          <StatusLegend />

          <div className="card overflow-x-auto p-4">
            <div className="grid grid-cols-7 gap-2" style={{ minWidth: 980 }}>
              {weekDates.map((d) => (
                <div key={d} className="space-y-2">
                  <Link
                    href={`/dashboard/agenda?view=day&date=${d}`}
                    className="block rounded-md px-1 py-1 text-center text-xs font-medium text-ink link-accent"
                  >
                    {new Date(`${d}T00:00:00${BRAZIL_UTC_OFFSET}`).toLocaleDateString("pt-BR", {
                      weekday: "short",
                    })}{" "}
                    {Number(d.slice(8, 10))}
                  </Link>
                  <div className="space-y-1">
                    {(byDate.get(d) ?? []).map((appt) => (
                      <Link
                        key={appt.id}
                        href={`/dashboard/agenda?view=day&date=${d}`}
                        className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] leading-tight ${STATUS_CLASS[appt.status]}`}
                      >
                        <span aria-hidden="true" className="text-[9px] leading-none">
                          {STATUS_GLYPH[appt.status]}
                        </span>
                        <span className="truncate">
                          {timeStringFromMinutes(minutesOfDayBR(appt.starts_at))} {appt.patient_name}
                        </span>
                      </Link>
                    ))}
                    {(byDate.get(d) ?? []).length === 0 && (
                      <p className="px-1 text-[11px] text-muted-soft">—</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // view === "day"
  const dayOfWeek = new Date(`${date}T00:00:00${BRAZIL_UTC_OFFSET}`).getUTCDay();

  const { data: professionals } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .in("role", ["admin", "profissional"])
    .order("full_name");

  const professionalIds = (professionals ?? []).map((p) => p.id);

  const [{ data: serviceTypes }, { data: appointments }, { data: workingHours }, { data: patients }] =
    await Promise.all([
      supabase
        .from("service_types")
        .select("id, name, duration_minutes")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      supabase
        .from("appointments")
        .select(
          "id, professional_id, patient_id, patient_name, patient_phone, starts_at, ends_at, status, service_types ( name )",
        )
        .eq("tenant_id", tenantId)
        .gte("starts_at", `${date}T00:00:00${BRAZIL_UTC_OFFSET}`)
        .lt("starts_at", `${addDays(date, 1)}T00:00:00${BRAZIL_UTC_OFFSET}`)
        .order("starts_at"),
      professionalIds.length > 0
        ? supabase
            .from("working_hours")
            .select("professional_id, start_time, end_time")
            .in("professional_id", professionalIds)
            .eq("day_of_week", dayOfWeek)
        : Promise.resolve({ data: [] as { professional_id: string; start_time: string; end_time: string }[] }),
      supabase
        .from("patients")
        .select("id, full_name, phone, email")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("full_name"),
    ]);

  // Faixa de horário da grade: cobre o expediente cadastrado e qualquer
  // agendamento existente (mesmo fora do expediente, ex: forçado pela
  // equipe), arredondado pra hora cheia.
  let gridStartMin = DEFAULT_START_MIN;
  let gridEndMin = DEFAULT_END_MIN;
  const bounds = [
    ...(workingHours ?? []).flatMap((w) => [
      minutesFromTimeString(w.start_time),
      minutesFromTimeString(w.end_time),
    ]),
    ...(appointments ?? []).flatMap((a) => [
      minutesOfDayBR(a.starts_at),
      minutesOfDayBR(a.ends_at),
    ]),
  ];
  if (bounds.length > 0) {
    gridStartMin = Math.min(DEFAULT_START_MIN, Math.floor(Math.min(...bounds) / 60) * 60);
    gridEndMin = Math.max(DEFAULT_END_MIN, Math.ceil(Math.max(...bounds) / 60) * 60);
  }
  const gridHeight = (gridEndMin - gridStartMin) * PX_PER_MIN;

  const hourMarks: number[] = [];
  for (let m = gridStartMin; m <= gridEndMin; m += 60) hourMarks.push(m);

  const slotMarks: number[] = [];
  for (let m = gridStartMin; m < gridEndMin; m += SLOT_MINUTES) slotMarks.push(m);

  const byProfessional = new Map<string, typeof appointments>();
  for (const p of professionals ?? []) byProfessional.set(p.id, []);
  for (const appt of appointments ?? []) {
    const list = byProfessional.get(appt.professional_id) ?? [];
    list.push(appt);
    byProfessional.set(appt.professional_id, list);
  }

  const patientOptions = (patients ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    phone: p.phone,
    email: p.email,
  }));

  // Conteúdo do formulário de agendamento manual — usado tanto no painel
  // fixo (telas largas) quanto no <details> recolhível (telas estreitas,
  // sem espaço pra um painel lateral sempre visível). É um valor JSX, não
  // um componente: usá-lo duas vezes só cria dois nós de árvore a partir
  // da mesma descrição, cada um com sua própria instância do
  // PatientPicker — não é "criar componente durante o render".
  const bookingForm = (
    <form action={createManualAppointment} className="space-y-3 text-sm">
      <input type="hidden" name="date" value={date} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="font-medium text-ink">Profissional</label>
          <select name="professionalId" required defaultValue={profId} className="input">
            {(professionals ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="font-medium text-ink">Serviço</label>
          <select name="serviceTypeId" required className="input">
            {(serviceTypes ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.duration_minutes}min)
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="font-medium text-ink">Horário</label>
          <input type="time" name="time" required defaultValue={prefillTime} className="input" />
        </div>
        <PatientPicker patients={patientOptions} initialPatientId={patientId} />
        <div className="space-y-1">
          <label className="font-medium text-ink">Repetir</label>
          <select name="recurrence" defaultValue="none" className="input">
            <option value="none">Não repetir</option>
            <option value="weekly">Semanalmente</option>
            <option value="biweekly">Quinzenalmente</option>
            <option value="monthly">Mensalmente</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="font-medium text-ink">Quantas vezes</label>
          <input type="number" name="occurrences" min={1} max={12} defaultValue={1} className="input" />
        </div>
      </div>
      <p className="text-[11px] text-muted-soft">
        Em caso de recorrência, cada data vira uma consulta independente (cada uma recebe sua
        própria pergunta de confirmação por WhatsApp) — se uma data colidir com outro horário, as
        demais continuam sendo agendadas normalmente.
      </p>
      <SubmitButton pendingText="Agendando..." className="btn-primary">
        Agendar
      </SubmitButton>
    </form>
  );

  const hasPrefill = Boolean(profId || prefillTime || patientId);

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <AgendaHeader
          view={view}
          date={date}
          undoAppointment={undoApptId ? { id: undoApptId, status: undoStatus ?? "pending" } : undefined}
        />

        <div className="lg:flex lg:items-start lg:gap-6">
          <div className="flex-1 space-y-6">
            <div className="flex items-center justify-between text-sm">
              <Link href={`/dashboard/agenda?date=${addDays(date, -1)}`} className="link-accent">
                &larr; dia anterior
              </Link>
              <form action="/dashboard/agenda" className="flex items-center gap-2">
                <input type="date" name="date" defaultValue={date} className="input py-1 text-sm" />
                <button type="submit" className="btn-secondary px-3 py-1.5 text-xs">
                  Ir
                </button>
              </form>
              <Link href={`/dashboard/agenda?date=${addDays(date, 1)}`} className="link-accent">
                próximo dia &rarr;
              </Link>
            </div>
            <p className="text-center text-sm font-medium text-ink">
              {new Date(`${date}T00:00:00${BRAZIL_UTC_OFFSET}`).toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </p>

            <StatusLegend />

            {(professionals ?? []).length === 0 ? (
              <p className="text-sm text-muted-soft">Nenhum profissional cadastrado.</p>
            ) : (
              <div className="card overflow-x-auto p-4">
                <p className="pb-2 text-[11px] text-muted-soft">
                  Clique num horário livre da grade pra agendar direto nele, ou use o formulário
                  manual.
                </p>
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `56px repeat(${(professionals ?? []).length}, minmax(180px, 1fr))`,
                  }}
                >
                  {/* sticky: em telas estreitas com mais de um profissional, a
                  grade rola na horizontal — sem isso a coluna de horários
                  (a referência de "que hora é essa consulta") some de vista. */}
                  <div className="sticky left-0 z-10 bg-paper" />
                  {(professionals ?? []).map((prof) => (
                    <div key={prof.id} className="pb-2 text-center text-sm font-medium text-ink">
                      {prof.full_name}
                    </div>
                  ))}

                  <div className="sticky left-0 z-10 bg-paper" style={{ height: gridHeight }}>
                    {hourMarks.map((m) => (
                      <div
                        key={m}
                        className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-soft"
                        style={{ top: (m - gridStartMin) * PX_PER_MIN }}
                      >
                        {timeStringFromMinutes(m)}
                      </div>
                    ))}
                  </div>

                  {(professionals ?? []).map((prof) => (
                    <div
                      key={prof.id}
                      className="relative border-l border-border"
                      style={{
                        height: gridHeight,
                        backgroundImage:
                          "repeating-linear-gradient(to bottom, var(--color-border) 0, var(--color-border) 1px, transparent 1px, transparent " +
                          60 * PX_PER_MIN +
                          "px)",
                      }}
                    >
                      {slotMarks.map((m) => (
                        <Link
                          key={m}
                          href={`/dashboard/agenda?date=${date}&profId=${prof.id}&time=${timeStringFromMinutes(m)}#agendar-form`}
                          aria-label={`Agendar ${timeStringFromMinutes(m)} com ${prof.full_name}`}
                          className="absolute inset-x-0 block hover:bg-accent-soft/50"
                          style={{ top: (m - gridStartMin) * PX_PER_MIN, height: SLOT_MINUTES * PX_PER_MIN }}
                        />
                      ))}

                      {(() => {
                        const dayAppts = byProfessional.get(prof.id) ?? [];
                        const lanes = layoutOverlapLanes(
                          dayAppts.map((a) => ({
                            id: a.id,
                            startMin: minutesOfDayBR(a.starts_at),
                            endMin: minutesOfDayBR(a.ends_at),
                          })),
                        );

                        return dayAppts.map((appt) => {
                          const service = Array.isArray(appt.service_types)
                            ? appt.service_types[0]
                            : appt.service_types;
                          const startMin = minutesOfDayBR(appt.starts_at);
                          const endMin = minutesOfDayBR(appt.ends_at);
                          const top = (startMin - gridStartMin) * PX_PER_MIN;
                          const height = Math.max((endMin - startMin) * PX_PER_MIN, 34);
                          const { col, cols } = lanes.get(appt.id) ?? { col: 0, cols: 1 };
                          const widthPct = 100 / cols;

                          return (
                            <div
                              key={appt.id}
                              className={`absolute overflow-hidden rounded-md border px-2 py-1 text-[11px] leading-tight ${STATUS_CLASS[appt.status]}`}
                              style={{
                                top,
                                height,
                                left: `calc(${col * widthPct}% + 2px)`,
                                width: `calc(${widthPct}% - 4px)`,
                              }}
                            >
                              <div className="font-semibold">
                                {timeStringFromMinutes(startMin)} ·{" "}
                                {appt.patient_id ? (
                                  <Link
                                    href={`/dashboard/pacientes/${appt.patient_id}`}
                                    className="underline hover:no-underline"
                                  >
                                    {appt.patient_name}
                                  </Link>
                                ) : (
                                  appt.patient_name
                                )}
                              </div>
                              <div className="truncate">
                                {service?.name} · {appt.patient_phone}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2">
                                <span className="font-medium">
                                  {STATUS_GLYPH[appt.status]} {STATUS_LABEL[appt.status]}
                                </span>
                                {appt.status === "pending" && (
                                  <form action={confirmAppointmentManually}>
                                    <input type="hidden" name="id" value={appt.id} />
                                    <SubmitButton
                                      pendingText="..."
                                      className="font-medium text-accent hover:text-accent-dark"
                                    >
                                      confirmar
                                    </SubmitButton>
                                  </form>
                                )}
                                {(appt.status === "pending" || appt.status === "confirmed") && (
                                  <form action={cancelAppointment}>
                                    <input type="hidden" name="id" value={appt.id} />
                                    <input type="hidden" name="date" value={date} />
                                    <ConfirmSubmitButton
                                      confirmMessage="Cancelar esta consulta?"
                                      pendingText="..."
                                      className="font-medium text-red-600 hover:text-red-700"
                                    >
                                      cancelar
                                    </ConfirmSubmitButton>
                                  </form>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(serviceTypes ?? []).length === 0 && (
              <p className="text-sm text-muted-soft">
                Nenhum serviço cadastrado ainda.{" "}
                <Link href="/dashboard/agenda/configuracoes" className="link-accent">
                  Configure os tipos de consulta
                </Link>{" "}
                antes de agendar.
              </p>
            )}

            {/* Telas estreitas: formulário recolhível no fim da página. */}
            <details
              key={`agendar-mobile-${profId ?? ""}-${prefillTime ?? ""}-${patientId ?? ""}`}
              id="agendar-form"
              className="card p-4 lg:hidden"
              open={hasPrefill ? true : undefined}
            >
              <summary className="cursor-pointer text-sm font-medium text-ink">
                Agendar manualmente
              </summary>
              <div className="mt-4">{bookingForm}</div>
            </details>
          </div>

          {/* Telas largas: painel fixo ao lado da grade, sempre visível —
          em vez do <details> recolhido no fim da página, que ficava fora
          de vista justo quando o clique num slot pedia atenção pro form. */}
          <aside className="hidden w-80 shrink-0 lg:block">
            <div className="card sticky top-6 p-4">
              <h2 className="mb-3 font-medium text-ink">Agendar manualmente</h2>
              {bookingForm}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
