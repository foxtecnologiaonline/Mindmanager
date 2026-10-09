import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { Toast } from "@/components/toast";
import { EmptyState } from "@/components/empty-state";
import { undoDeletePatient } from "@/lib/patients/actions";

export const metadata: Metadata = { title: "Pacientes" };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ undoPatientId?: string }>;
}) {
  const { tenantId } = await getTenantContext();
  const { undoPatientId } = await searchParams;
  const supabase = await createClient();

  const { data: patients } = await supabase
    .from("patients")
    .select("id, full_name, phone, email, created_at")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("full_name");

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="heading text-2xl">Pacientes</h1>
          <Link href="/dashboard/pacientes/novo" className="btn-primary">
            Novo paciente
          </Link>
        </div>

        <Suspense fallback={null}>
          <Toast
            undo={
              undoPatientId
                ? { action: undoDeletePatient, fields: { id: undoPatientId } }
                : undefined
            }
          />
        </Suspense>

        {(patients ?? []).length === 0 ? (
          <EmptyState
            title="Nenhum paciente cadastrado ainda"
            description="Pacientes também são criados automaticamente ao agendar uma consulta."
            actionHref="/dashboard/pacientes/novo"
            actionLabel="Cadastrar primeiro paciente"
          />
        ) : (
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
          </div>
        )}
      </div>
    </main>
  );
}
