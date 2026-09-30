import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  createServiceType,
  createWorkingHour,
  deactivateServiceType,
  deleteWorkingHour,
} from "@/lib/scheduling/actions";

const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

export default async function AgendaConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

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

  const [{ data: professionals }, { data: serviceTypes }, { data: workingHours }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("tenant_id", profile.tenant_id)
        .in("role", ["admin", "profissional"])
        .order("full_name"),
      supabase
        .from("service_types")
        .select("id, name, duration_minutes, price_cents, active")
        .eq("tenant_id", profile.tenant_id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("working_hours")
        .select("id, professional_id, day_of_week, start_time, end_time")
        .order("day_of_week"),
    ]);

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Configurações da agenda</h1>
          <Link href="/dashboard/agenda" className="text-sm underline">
            Voltar para a agenda
          </Link>
        </div>

        {error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>
        )}

        <section className="space-y-3">
          <h2 className="font-medium">Tipos de consulta</h2>
          <ul className="space-y-1 text-sm">
            {(serviceTypes ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between border-b py-1">
                <span>
                  {s.name} — {s.duration_minutes}min
                  {s.price_cents != null &&
                    ` — R$ ${(s.price_cents / 100).toFixed(2)}`}
                </span>
                <form action={deactivateServiceType}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="text-xs text-red-600 underline">
                    remover
                  </button>
                </form>
              </li>
            ))}
            {(serviceTypes ?? []).length === 0 && (
              <li className="text-neutral-500">Nenhum tipo de consulta cadastrado.</li>
            )}
          </ul>
          <form action={createServiceType} className="flex flex-wrap items-end gap-2 text-sm">
            <div className="space-y-1">
              <label className="font-medium">Nome</label>
              <input name="name" required className="rounded border px-2 py-1" />
            </div>
            <div className="space-y-1">
              <label className="font-medium">Duração (min)</label>
              <input
                name="durationMinutes"
                type="number"
                min={5}
                step={5}
                required
                className="w-24 rounded border px-2 py-1"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium">Preço (R$, opcional)</label>
              <input
                name="price"
                type="number"
                min={0}
                step="0.01"
                className="w-28 rounded border px-2 py-1"
              />
            </div>
            <button type="submit" className="rounded bg-black px-3 py-1.5 text-white">
              Adicionar
            </button>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium">Horários de trabalho</h2>
          <ul className="space-y-1 text-sm">
            {(workingHours ?? []).map((w) => {
              const prof = (professionals ?? []).find((p) => p.id === w.professional_id);
              return (
                <li key={w.id} className="flex items-center justify-between border-b py-1">
                  <span>
                    {prof?.full_name} — {WEEKDAYS[w.day_of_week]} — {w.start_time.slice(0, 5)}
                    {" às "}
                    {w.end_time.slice(0, 5)}
                  </span>
                  <form action={deleteWorkingHour}>
                    <input type="hidden" name="id" value={w.id} />
                    <button type="submit" className="text-xs text-red-600 underline">
                      remover
                    </button>
                  </form>
                </li>
              );
            })}
            {(workingHours ?? []).length === 0 && (
              <li className="text-neutral-500">Nenhum horário cadastrado.</li>
            )}
          </ul>
          <form action={createWorkingHour} className="flex flex-wrap items-end gap-2 text-sm">
            <div className="space-y-1">
              <label className="font-medium">Profissional</label>
              <select name="professionalId" required className="rounded border px-2 py-1">
                {(professionals ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-medium">Dia</label>
              <select name="dayOfWeek" required className="rounded border px-2 py-1">
                {WEEKDAYS.map((label, i) => (
                  <option key={i} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-medium">Início</label>
              <input
                name="startTime"
                type="time"
                required
                className="rounded border px-2 py-1"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium">Fim</label>
              <input name="endTime" type="time" required className="rounded border px-2 py-1" />
            </div>
            <button type="submit" className="rounded bg-black px-3 py-1.5 text-white">
              Adicionar
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
