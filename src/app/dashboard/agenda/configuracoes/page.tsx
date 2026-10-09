import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { WhatsappConnection } from "@/components/whatsapp-connection";
import { uploadTenantLogo } from "@/lib/branding/actions";
import {
  createServiceType,
  createWorkingHour,
  deactivateServiceType,
  deleteWorkingHour,
} from "@/lib/scheduling/actions";

export const metadata: Metadata = { title: "Configurações da agenda" };

const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

export default async function AgendaConfigPage() {
  const { tenantId, role, logoUrl } = await getTenantContext();
  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("whatsapp_mode, whatsapp_number_id")
    .eq("id", tenantId)
    .single();

  const [{ data: professionals }, { data: serviceTypes }, { data: workingHours }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("tenant_id", tenantId)
        .in("role", ["admin", "profissional"])
        .order("full_name"),
      supabase
        .from("service_types")
        .select("id, name, duration_minutes, price_cents, active")
        .eq("tenant_id", tenantId)
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
        <h1 className="heading text-2xl">Configurações da agenda</h1>

        <Suspense fallback={null}>
          <Toast />
        </Suspense>

        <section className="space-y-3">
          <h2 className="font-medium text-ink">Logo da clínica</h2>
          <p className="text-sm text-muted-soft">
            Aparece na página pública de agendamento e no dashboard.
          </p>
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt="Logo atual"
                width={56}
                height={56}
                className="rounded-lg border border-border object-contain"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-border text-[10px] text-muted-soft">
                sem logo
              </div>
            )}
            <form action={uploadTenantLogo} className="flex items-center gap-2 text-sm">
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                required
                className="text-xs"
              />
              <SubmitButton
                pendingText="Enviando..."
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                Enviar logo
              </SubmitButton>
            </form>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium text-ink">Número de WhatsApp</h2>
          <p className="text-sm text-muted-soft">
            Define de onde saem a pergunta de confirmação e os lembretes — e pra onde o
            paciente responde.
          </p>
          <WhatsappConnection
            mode={(tenant?.whatsapp_mode as "shared" | "own") ?? "shared"}
            numberId={tenant?.whatsapp_number_id ?? null}
            isAdmin={role === "admin"}
          />
        </section>

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
                  <SubmitButton
                    pendingText="..."
                    className="text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    remover
                  </SubmitButton>
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
            <SubmitButton pendingText="Adicionando..." className="btn-primary">
              Adicionar
            </SubmitButton>
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
                    <SubmitButton
                      pendingText="..."
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      remover
                    </SubmitButton>
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
            <SubmitButton pendingText="Adicionando..." className="btn-primary">
              Adicionar
            </SubmitButton>
          </form>
        </section>
      </div>
    </main>
  );
}
