import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/lib/actions";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, role, tenant_id, tenants ( name, slug, billing_status, trial_ends_at, logo_url )",
    )
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) {
    redirect("/onboarding");
  }

  const tenant = Array.isArray(profile.tenants)
    ? profile.tenants[0]
    : profile.tenants;

  const { start, end } = todayRangeBR();
  const [{ count: todayCount }, { count: pendingCount }] = await Promise.all([
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", profile.tenant_id)
      .neq("status", "cancelled")
      .gte("starts_at", start)
      .lte("starts_at", end),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", profile.tenant_id)
      .eq("status", "pending")
      .gte("starts_at", start)
      .lte("starts_at", end),
  ]);

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {tenant?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element -- logo de tenant arbitrário, sem domínio fixo pra configurar no next.config
              <img
                src={tenant.logo_url}
                alt={`Logo de ${tenant.name}`}
                className="h-10 w-10 rounded-lg border border-border object-contain"
              />
            )}
            <div>
              <h1 className="heading text-2xl">{tenant?.name}</h1>
              <p className="text-sm text-muted">
                {profile.full_name} · {profile.role}
              </p>
            </div>
          </div>
          <form action={logout}>
            <button type="submit" className="link-accent text-sm">
              Sair
            </button>
          </form>
        </div>
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
