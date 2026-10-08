import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureTenantId } from "@/lib/tenant";
import { Toast } from "@/components/toast";

export const metadata: Metadata = { title: "Pacientes" };

export default async function PatientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profileQuery = () =>
    supabase.from("profiles").select("tenant_id, full_name").eq("id", user.id).single();

  let { data: profile } = await profileQuery();

  if (!profile?.tenant_id) {
    await ensureTenantId(supabase, user.id, profile?.full_name ?? null);
    ({ data: profile } = await profileQuery());
  }

  const tenantId = profile!.tenant_id as string;

  const { data: patients } = await supabase
    .from("patients")
    .select("id, full_name, phone, email, created_at")
    .eq("tenant_id", tenantId)
    .order("full_name");

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="heading text-2xl">Pacientes</h1>
          <Link href="/dashboard" className="link-accent text-sm">
            Voltar ao dashboard
          </Link>
        </div>

        <Suspense fallback={null}>
          <Toast />
        </Suspense>

        <Link href="/dashboard/pacientes/novo" className="btn-primary inline-block">
          Novo paciente
        </Link>

        <div className="card divide-y divide-border">
          {(patients ?? []).map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/pacientes/${p.id}`}
              className="flex items-center justify-between p-4 text-sm hover:bg-accent-soft"
            >
              <div>
                <p className="font-medium text-ink">{p.full_name}</p>
                <p className="text-muted-soft">
                  {p.phone}
                  {p.email && ` · ${p.email}`}
                </p>
              </div>
              <span className="text-muted-soft">
                {new Date(p.created_at).toLocaleDateString("pt-BR")}
              </span>
            </Link>
          ))}
          {(patients ?? []).length === 0 && (
            <p className="p-4 text-sm text-muted-soft">
              Nenhum paciente cadastrado ainda.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
