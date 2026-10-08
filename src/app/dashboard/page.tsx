import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/lib/actions";
import { ensureTenantId } from "@/lib/tenant";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profileQuery = () =>
    supabase
      .from("profiles")
      .select(
        "full_name, role, tenant_id, tenants ( name, slug, billing_status, trial_ends_at, logo_url )",
      )
      .eq("id", user.id)
      .single();

  let { data: profile } = await profileQuery();

  if (!profile?.tenant_id) {
    // Rede de segurança: desde a migration 0007 isso não deveria faltar
    // nunca (o tenant nasce no trigger de signup), mas resolve aqui
    // mesmo em vez de redirecionar — sem isso o usuário via um hop
    // visível por /onboarding logo depois do cadastro/login.
    await ensureTenantId(supabase, user.id, profile?.full_name ?? null);
    ({ data: profile } = await profileQuery());
  }

  const tenantId = profile!.tenant_id as string;
  const tenant = Array.isArray(profile!.tenants)
    ? profile!.tenants[0]
    : profile!.tenants;

  const { data: professionals } = await supabase
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenantId);
  const professionalIds = (professionals ?? []).map((p) => p.id);

  const { start, end } = todayRangeBR();
  const [
    { count: todayCount },
    { count: pendingCount },
    { count: serviceTypeCount },
    { count: workingHourCount },
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
    professionalIds.length > 0
      ? supabase
          .from("working_hours")
          .select("id", { count: "exact", head: true })
          .in("professional_id", professionalIds)
      : Promise.resolve({ count: 0 }),
  ]);

  const hasServiceType = (serviceTypeCount ?? 0) > 0;
  const hasWorkingHour = (workingHourCount ?? 0) > 0;
  const setupDone = hasServiceType && hasWorkingHour;

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {tenant?.logo_url && (
              <Image
                src={tenant.logo_url}
                alt={`Logo de ${tenant.name}`}
                width={40}
                height={40}
                className="rounded-lg border border-border object-contain"
              />
            )}
            <div>
              <h1 className="heading text-2xl">{tenant?.name}</h1>
              <p className="text-sm text-muted">
                {profile!.full_name} · {profile!.role}
              </p>
            </div>
          </div>
          <form action={logout}>
            <button type="submit" className="link-accent text-sm">
              Sair
            </button>
          </form>
        </div>

        {!setupDone && (
          <div className="card space-y-3 p-4 text-sm">
            <h2 className="font-medium text-ink">Primeiros passos</h2>
            <ul className="space-y-2">
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                    hasServiceType
                      ? "bg-accent text-white"
                      : "border border-dashed border-border text-muted-soft"
                  }`}
                >
                  {hasServiceType ? "✓" : "1"}
                </span>
                {hasServiceType ? (
                  <span className="text-muted-soft line-through">
                    Cadastrar um tipo de consulta
                  </span>
                ) : (
                  <Link
                    href="/dashboard/agenda/configuracoes"
                    className="link-accent"
                  >
                    Cadastrar um tipo de consulta
                  </Link>
                )}
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                    hasWorkingHour
                      ? "bg-accent text-white"
                      : "border border-dashed border-border text-muted-soft"
                  }`}
                >
                  {hasWorkingHour ? "✓" : "2"}
                </span>
                {hasWorkingHour ? (
                  <span className="text-muted-soft line-through">
                    Configurar seu horário de trabalho
                  </span>
                ) : (
                  <Link
                    href="/dashboard/agenda/configuracoes"
                    className="link-accent"
                  >
                    Configurar seu horário de trabalho
                  </Link>
                )}
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[11px] text-muted-soft"
                >
                  3
                </span>
                {tenant?.slug ? (
                  <span>
                    Compartilhar o{" "}
                    <Link
                      href={`/agendar/${tenant.slug}`}
                      className="link-accent"
                    >
                      link de agendamento
                    </Link>{" "}
                    com os pacientes
                  </span>
                ) : (
                  <span className="text-muted-soft">
                    Compartilhar o link de agendamento com os pacientes
                  </span>
                )}
              </li>
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Link href="/dashboard/agenda" className="card p-4 hover:bg-accent-soft">
            <p className="text-2xl font-semibold text-ink">{todayCount ?? 0}</p>
            <p className="text-sm text-muted">consultas hoje</p>
          </Link>
          <Link href="/dashboard/agenda" className="card p-4 hover:bg-accent-soft">
            <p className="text-2xl font-semibold text-ink">{pendingCount ?? 0}</p>
            <p className="text-sm text-muted">pendentes de confirmação</p>
          </Link>
        </div>
        <div className="card p-4 text-sm">
          <p>
            Plano: <strong>{tenant?.billing_status}</strong>
          </p>
          {tenant?.billing_status === "trial" && (
            <p className="text-muted">
              Trial até{" "}
              {tenant?.trial_ends_at &&
                new Date(tenant.trial_ends_at).toLocaleDateString("pt-BR")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard/agenda" className="btn-primary">
            Ver agenda
          </Link>
          <Link href="/dashboard/pacientes" className="btn-secondary">
            Pacientes
          </Link>
          {tenant?.slug && (
            <Link href={`/agendar/${tenant.slug}`} className="link-accent text-sm">
              Link público de agendamento
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
