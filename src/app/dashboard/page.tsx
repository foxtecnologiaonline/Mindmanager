import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/lib/actions";

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
      "full_name, role, tenant_id, tenants ( name, slug, billing_status, trial_ends_at )",
    )
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) {
    redirect("/onboarding");
  }

  const tenant = Array.isArray(profile.tenants)
    ? profile.tenants[0]
    : profile.tenants;

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="heading text-2xl">{tenant?.name}</h1>
            <p className="text-sm text-muted">
              {profile.full_name} · {profile.role}
            </p>
          </div>
          <form action={logout}>
            <button type="submit" className="link-accent text-sm">
              Sair
            </button>
          </form>
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
