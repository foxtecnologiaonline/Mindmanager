import type { Metadata } from "next";
import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";

export const metadata: Metadata = { title: "Dashboard" };

function todayRangeBR() {
  // Simplificação MVP: mesmo offset fixo usado no resto do produto
  // (America/Sao_Paulo, sem DST desde 2019; ver scheduling/actions.ts).
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const start = `${todayStr}T00:00:00-03:00`;
  const end = `${todayStr}T23:59:59.999-03:00`;
  return { start, end };
}

export default async function DashboardPage() {
  const { tenantId, tenantName, tenantSlug, logoUrl } = await getTenantContext();
  const supabase = await createClient();

  const { start, end } = todayRangeBR();
  const [
    { count: todayCount },
    { count: pendingCount },
    { count: serviceTypeCount },
    { count: workingHourCount },
    { count: patientCount },
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .gte("starts_at", start)
      .lte("starts_at", end),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .gte("starts_at", start)
      .lte("starts_at", end),
    supabase
      .from("service_types")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabase
      .from("working_hours")
      .select("id, profiles!inner(tenant_id)", { count: "exact", head: true })
      .eq("profiles.tenant_id", tenantId),
    supabase
      .from("patients")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("deleted_at", null),
  ]);

  const hasServiceType = (serviceTypeCount ?? 0) > 0;
  const hasWorkingHour = (workingHourCount ?? 0) > 0;
  const hasPatient = (patientCount ?? 0) > 0;
  const steps = [
    {
      key: "service",
      label: "Tipo de consulta",
      done: hasServiceType,
      href: "/dashboard/agenda/configuracoes",
    },
    {
      key: "hours",
      label: "Horário de trabalho",
      done: hasWorkingHour,
      href: "/dashboard/agenda/configuracoes",
    },
    { key: "patient", label: "Primeiro paciente", done: hasPatient, href: "/dashboard/pacientes/novo" },
  ];
  const completedSteps = steps.filter((s) => s.done).length;
  const setupDone = completedSteps === steps.length;

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div
          className="flex flex-wrap items-center gap-4 rounded-2xl p-5"
          style={{
            background:
              "linear-gradient(135deg, var(--color-accent-soft), var(--color-surface))",
          }}
        >
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={`Logo de ${tenantName ?? "clínica"}`}
              width={48}
              height={48}
              className="rounded-xl border border-border bg-surface object-contain"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-lg font-semibold text-white">
              {tenantName?.charAt(0)?.toUpperCase() ?? "M"}
            </div>
          )}
          <div className="flex-1">
            <h1 className="heading text-2xl">{tenantName}</h1>
          </div>
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-2xl font-semibold text-ink">{todayCount ?? 0}</p>
              <p className="text-xs text-muted">consultas hoje</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-ink">{pendingCount ?? 0}</p>
              <p className="text-xs text-muted">pendentes</p>
            </div>
          </div>
        </div>

        {!setupDone && (
          <div className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-ink">Primeiros passos</h2>
              <span className="text-xs text-muted-soft">
                {completedSteps}/{steps.length}
              </span>
            </div>
            <div className="flex items-start">
              {steps.map((step, i) => (
                <Fragment key={step.key}>
                  <div className="flex w-20 flex-col items-center gap-1.5 text-center sm:w-28">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-transform ${
                        step.done
                          ? "animate-success-pulse scale-100 bg-accent text-white"
                          : "border-2 border-dashed border-border text-muted-soft"
                      }`}
                    >
                      {step.done ? "✓" : i + 1}
                    </span>
                    {step.done ? (
                      <span className="text-xs text-muted-soft">{step.label}</span>
                    ) : step.href ? (
                      <Link href={step.href} className="link-accent text-xs">
                        {step.label}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-soft">{step.label}</span>
                    )}
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className={`mt-4 h-0.5 flex-1 ${step.done ? "bg-accent" : "bg-border"}`}
                    />
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Link href="/dashboard/agenda" className="card p-4 hover:bg-accent-soft">
            <p className="font-medium text-ink">Ver agenda</p>
            <p className="text-sm text-muted-soft">Diário, semanal e mensal</p>
          </Link>
          <Link href="/dashboard/pacientes" className="card p-4 hover:bg-accent-soft">
            <p className="font-medium text-ink">Pacientes</p>
            <p className="text-sm text-muted-soft">{patientCount ?? 0} cadastrado(s)</p>
          </Link>
          {tenantSlug && (
            <Link href={`/agendar/${tenantSlug}`} className="card p-4 hover:bg-accent-soft">
              <p className="font-medium text-ink">Link público</p>
              <p className="truncate text-sm text-muted-soft">/agendar/{tenantSlug}</p>
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
