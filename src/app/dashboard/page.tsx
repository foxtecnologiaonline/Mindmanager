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
            <h1 className="text-2xl font-semibold">{tenant?.name}</h1>
            <p className="text-sm text-neutral-600">
              {profile.full_name} · {profile.role}
            </p>
          </div>
          <form action={logout}>
            <button type="submit" className="text-sm underline">
              Sair
            </button>
          </form>
        </div>
        <div className="rounded border p-4 text-sm">
          <p>
            Plano: <strong>{tenant?.billing_status}</strong>
          </p>
          {tenant?.billing_status === "trial" && (
            <p className="text-neutral-600">
              Trial até{" "}
              {tenant?.trial_ends_at &&
                new Date(tenant.trial_ends_at).toLocaleDateString("pt-BR")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/agenda"
            className="rounded bg-black px-4 py-2 text-sm text-white"
          >
            Ver agenda
          </Link>
          {tenant?.slug && (
            <Link href={`/agendar/${tenant.slug}`} className="text-sm underline">
              Link público de agendamento
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
