import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  cancelAppointment,
  confirmAppointmentManually,
  createManualAppointment,
} from "@/lib/scheduling/actions";

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

function minutesOfDayBR(iso: string) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .split(":");
  return Number(h) * 60 + Number(m);
}

function minutesFromTimeString(t: string) {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

const PX_PER_MIN = 1.4;
const DEFAULT_START_MIN = 7 * 60;
const DEFAULT_END_MIN = 20 * 60;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Concluído",
  no_show: "Faltou",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "border-amber-300 bg-amber-50 text-amber-900",
  confirmed: "border-accent bg-accent-soft text-ink",
  cancelled: "border-border bg-paper text-muted-soft line-through opacity-70",
  completed: "border-border bg-paper text-muted-soft",
  no_show: "border-border bg-paper text-muted-soft",
};

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const { date: dateParam, error } = await searchParams;
  const date = dateParam ?? formatDate(new Date());
  const dayOfWeek = new Date(`${date}T00:00:00-03:00`).getUTCDay();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) {
    redirect("/onboarding");
  }

  const { data: professionals } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("tenant_id", profile.tenant_id)
    .in("role", ["admin", "profissional"])
    .order("full_name");

  const professionalIds = (professionals ?? []).map((p) => p.id);

  const [{ data: serviceTypes }, { data: appointments }, { data: workingHours }] =
    await Promise.all([
      supabase
        .from("service_types")
        .select("id, name, duration_minutes")
        .eq("tenant_id", profile.tenant_id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("appointments")
        .select(
          "id, professional_id, patient_name, patient_phone, starts_at, ends_at, status, service_types ( name )",
        )
        .eq("tenant_id", profile.tenant_id)
        .gte("starts_at", `${date}T00:00:00-03:00`)
        .lt("starts_at", `${addDays(date, 1)}T00:00:00-03:00`)
        .order("starts_at"),
      professionalIds.length > 0
        ? supabase
            .from("working_hours")
            .select("professional_id, start_time, end_time")
            .in("professional_id", professionalIds)
            .eq("day_of_week", dayOfWeek)
        : Promise.resolve({ data: [] as { professional_id: string; start_time: string; end_time: string }[] }),
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

  const byProfessional = new Map<string, typeof appointments>();
  for (const p of professionals ?? []) byProfessional.set(p.id, []);
  for (const appt of appointments ?? []) {
    const list = byProfessional.get(appt.professional_id) ?? [];
    list.push(appt);
    byProfessional.set(appt.professional_id, list);
  }

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="heading text-2xl">Agenda</h1>
          <Link href="/dashboard/agenda/configuracoes" className="link-accent text-sm">
            Configurar serviços e horários
          </Link>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>
        )}

        <div className="flex items-center justify-between text-sm">
          <Link href={`/dashboard/agenda?date=${addDays(date, -1)}`} className="link-accent">
            &larr; dia anterior
          </Link>
          <form action="/dashboard/agenda" className="flex items-center gap-2">
            <input
              type="date"
              name="date"
              defaultValue={date}
              className="input py-1 text-sm"
            />
            <button type="submit" className="btn-secondary px-3 py-1.5 text-xs">
              Ir
            </button>
          </form>
          <Link href={`/dashboard/agenda?date=${addDays(date, 1)}`} className="link-accent">
            próximo dia &rarr;
          </Link>
        </div>
        <p className="text-center text-sm font-medium text-ink">
          {new Date(`${date}T00:00:00-03:00`).toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
          })}
        </p>

        <div className="flex gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full border border-amber-300 bg-amber-50" />
            Pendente
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full border border-accent bg-accent-soft" />
            Confirmado
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full border border-border bg-paper" />
            Cancelado/concluído
          </span>
        </div>

        {(professionals ?? []).length === 0 ? (
          <p className="text-sm text-muted-soft">Nenhum profissional cadastrado.</p>
        ) : (
          <div className="card overflow-x-auto p-4">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `56px repeat(${(professionals ?? []).length}, minmax(180px, 1fr))`,
              }}
            >
              <div />
              {(professionals ?? []).map((prof) => (
                <div key={prof.id} className="pb-2 text-center text-sm font-medium text-ink">
                  {prof.full_name}
                </div>
              ))}

              <div className="relative" style={{ height: gridHeight }}>
                {hourMarks.map((m) => (
                  <div
                    key={m}
                    className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-soft"
                    style={{ top: (m - gridStartMin) * PX_PER_MIN }}
                  >
                    {String(Math.floor(m / 60)).padStart(2, "0")}:
                    {String(m % 60).padStart(2, "0")}
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
                  {(byProfessional.get(prof.id) ?? []).map((appt) => {
                    const service = Array.isArray(appt.service_types)
                      ? appt.service_types[0]
                      : appt.service_types;
                    const startMin = minutesOfDayBR(appt.starts_at);
                    const endMin = minutesOfDayBR(appt.ends_at);
                    const top = (startMin - gridStartMin) * PX_PER_MIN;
                    const height = Math.max((endMin - startMin) * PX_PER_MIN, 34);

                    return (
                      <div
                        key={appt.id}
                        className={`absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-[11px] leading-tight ${STATUS_CLASS[appt.status]}`}
                        style={{ top, height }}
                      >
                        <div className="font-semibold">
                          {String(Math.floor(startMin / 60)).padStart(2, "0")}:
                          {String(startMin % 60).padStart(2, "0")} · {appt.patient_name}
                        </div>
                        <div className="truncate">
                          {service?.name} · {appt.patient_phone}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="font-medium">{STATUS_LABEL[appt.status]}</span>
                          {appt.status === "pending" && (
                            <form action={confirmAppointmentManually}>
                              <input type="hidden" name="id" value={appt.id} />
                              <button
                                type="submit"
                                className="font-medium text-accent hover:text-accent-dark"
                              >
                                confirmar
                              </button>
                            </form>
                          )}
                          {(appt.status === "pending" || appt.status === "confirmed") && (
                            <form action={cancelAppointment}>
                              <input type="hidden" name="id" value={appt.id} />
                              <button
                                type="submit"
                                className="font-medium text-red-600 hover:text-red-700"
                              >
                                cancelar
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            Agendar manualmente
          </summary>
          <form action={createManualAppointment} className="mt-4 space-y-3 text-sm">
            <input type="hidden" name="date" value={date} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-medium text-ink">Profissional</label>
                <select name="professionalId" required className="input">
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
                <input type="time" name="time" required className="input" />
              </div>
              <div className="space-y-1">
                <label className="font-medium text-ink">Nome do paciente</label>
                <input name="patientName" required className="input" />
              </div>
              <div className="space-y-1">
                <label className="font-medium text-ink">Telefone</label>
                <input
                  name="patientPhone"
                  required
                  placeholder="55119..."
                  className="input"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium text-ink">E-mail (opcional)</label>
                <input name="patientEmail" type="email" className="input" />
              </div>
            </div>
            <button type="submit" className="btn-primary">
              Agendar
            </button>
          </form>
        </details>

        {(serviceTypes ?? []).length === 0 && (
          <p className="text-sm text-muted-soft">
            Nenhum serviço cadastrado ainda.{" "}
            <Link href="/dashboard/agenda/configuracoes" className="link-accent">
              Configure os tipos de consulta
            </Link>{" "}
            antes de agendar.
          </p>
        )}
      </div>
    </main>
  );
}
