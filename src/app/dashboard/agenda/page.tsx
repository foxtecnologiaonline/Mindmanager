import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cancelAppointment, createManualAppointment } from "@/lib/scheduling/actions";

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const { date: dateParam, error } = await searchParams;
  const date = dateParam ?? formatDate(new Date());

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

  const [{ data: professionals }, { data: serviceTypes }, { data: appointments }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("tenant_id", profile.tenant_id)
        .in("role", ["admin", "profissional"])
        .order("full_name"),
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
    ]);

  const byProfessional = new Map<string, typeof appointments>();
  for (const p of professionals ?? []) byProfessional.set(p.id, []);
  for (const appt of appointments ?? []) {
    const list = byProfessional.get(appt.professional_id) ?? [];
    list.push(appt);
    byProfessional.set(appt.professional_id, list);
  }

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <Link href="/dashboard/agenda/configuracoes" className="text-sm underline">
            Configurar serviços e horários
          </Link>
        </div>

        {error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>
        )}

        <div className="flex items-center justify-between text-sm">
          <Link href={`/dashboard/agenda?date=${addDays(date, -1)}`} className="underline">
            &larr; dia anterior
          </Link>
          <span className="font-medium">
            {new Date(`${date}T00:00:00-03:00`).toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </span>
          <Link href={`/dashboard/agenda?date=${addDays(date, 1)}`} className="underline">
            próximo dia &rarr;
          </Link>
        </div>

        {(professionals ?? []).map((prof) => (
          <div key={prof.id} className="space-y-2 rounded border p-4">
            <h2 className="font-medium">{prof.full_name}</h2>
            <ul className="space-y-1 text-sm">
              {(byProfessional.get(prof.id) ?? []).length === 0 && (
                <li className="text-neutral-500">Sem agendamentos neste dia.</li>
              )}
              {(byProfessional.get(prof.id) ?? []).map((appt) => {
                const service = Array.isArray(appt.service_types)
                  ? appt.service_types[0]
                  : appt.service_types;
                return (
                  <li
                    key={appt.id}
                    className="flex items-center justify-between gap-2 border-b py-1 last:border-0"
                  >
                    <span
                      className={appt.status === "cancelled" ? "line-through text-neutral-400" : ""}
                    >
                      {new Date(appt.starts_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Sao_Paulo",
                      })}{" "}
                      — {appt.patient_name} ({service?.name}) — {appt.patient_phone}
                    </span>
                    {appt.status === "confirmed" && (
                      <form action={cancelAppointment}>
                        <input type="hidden" name="id" value={appt.id} />
                        <button type="submit" className="text-xs text-red-600 underline">
                          cancelar
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <details className="rounded border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Agendar manualmente
          </summary>
          <form action={createManualAppointment} className="mt-4 space-y-3 text-sm">
            <input type="hidden" name="date" value={date} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-medium">Profissional</label>
                <select
                  name="professionalId"
                  required
                  className="w-full rounded border px-2 py-1"
                >
                  {(professionals ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-medium">Serviço</label>
                <select
                  name="serviceTypeId"
                  required
                  className="w-full rounded border px-2 py-1"
                >
                  {(serviceTypes ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration_minutes}min)
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-medium">Horário</label>
                <input
                  type="time"
                  name="time"
                  required
                  className="w-full rounded border px-2 py-1"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">Nome do paciente</label>
                <input
                  name="patientName"
                  required
                  className="w-full rounded border px-2 py-1"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">Telefone</label>
                <input
                  name="patientPhone"
                  required
                  placeholder="55119..."
                  className="w-full rounded border px-2 py-1"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">E-mail (opcional)</label>
                <input
                  name="patientEmail"
                  type="email"
                  className="w-full rounded border px-2 py-1"
                />
              </div>
            </div>
            <button type="submit" className="rounded bg-black px-4 py-2 text-white">
              Agendar
            </button>
          </form>
        </details>

        {(serviceTypes ?? []).length === 0 && (
          <p className="text-sm text-neutral-500">
            Nenhum serviço cadastrado ainda.{" "}
            <Link href="/dashboard/agenda/configuracoes" className="underline">
              Configure os tipos de consulta
            </Link>{" "}
            antes de agendar.
          </p>
        )}
      </div>
    </main>
  );
}
