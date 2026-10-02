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
          <h1 className="heading text-2xl">Configurações da agenda</h1>
          <Link href="/dashboard/agenda" className="link-accent text-sm">
            Voltar para a agenda
          </Link>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>
        )}

        <section className="space-y-3">
          <h2 className="font-medium text-ink">Tipos de consulta</h2>
          <ul className="space-y-1 text-sm">
            {(serviceTypes ?? []).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between border-b border-border py-1"
              >
                <span className="text-ink">
                  {s.name} — {s.duration_minutes}min
                  {s.price_cents != null &&
                    ` — R$ ${(s.price_cents / 100).toFixed(2)}`}
                </span>
                <form action={deactivateServiceType}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="text-xs font-medium text-red-600 hover:text-red-700">
                    remover
                  </button>
                </form>
              </li>
            ))}
            {(serviceTypes ?? []).length === 0 && (
              <li className="text-muted-soft">Nenhum tipo de consulta cadastrado.</li>
            )}
          </ul>
          <form action={createServiceType} className="flex flex-wrap items-end gap-2 text-sm">
            <div className="space-y-1">
              <label className="font-medium text-ink">Nome</label>
              <input name="name" required className="input" />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-ink">Duração (min)</label>
              <input
                name="durationMinutes"
                type="number"
                min={5}
                step={5}
                required
                className="input w-24"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-ink">Preço (R$, opcional)</label>
              <input
                name="price"
                type="number"
                min={0}
                step="0.01"
                className="input w-28"
              />
            </div>
            <button type="submit" className="btn-primary">
              Adicionar
            </button>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium text-ink">Horários de trabalho</h2>
          <ul className="space-y-1 text-sm">
            {(workingHours ?? []).map((w) => {
              const prof = (professionals ?? []).find((p) => p.id === w.professional_id);
              return (
                <li
                  key={w.id}
                  className="flex items-center justify-between border-b border-border py-1"
                >
                  <span className="text-ink">
                    {prof?.full_name} — {WEEKDAYS[w.day_of_week]} — {w.start_time.slice(0, 5)}
                    {" às "}
                    {w.end_time.slice(0, 5)}
                  </span>
                  <form action={deleteWorkingHour}>
                    <input type="hidden" name="id" value={w.id} />
                    <button type="submit" className="text-xs font-medium text-red-600 hover:text-red-700">
                      remover
                    </button>
                  </form>
                </li>
              );
            })}
            {(workingHours ?? []).length === 0 && (
              <li className="text-muted-soft">Nenhum horário cadastrado.</li>
            )}
          </ul>
          <form action={createWorkingHour} className="flex flex-wrap items-end gap-2 text-sm">
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
              <label className="font-medium text-ink">Dia</label>
              <select name="dayOfWeek" required className="input">
                {WEEKDAYS.map((label, i) => (
                  <option key={i} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-medium text-ink">Início</label>
              <input name="startTime" type="time" required className="input" />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-ink">Fim</label>
              <input name="endTime" type="time" required className="input" />
            </div>
            <button type="submit" className="btn-primary">
              Adicionar
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
