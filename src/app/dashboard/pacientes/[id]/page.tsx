import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { registerConsent } from "@/lib/clinical/actions";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { deletePatient, updatePatient } from "@/lib/patients/actions";

export const metadata: Metadata = { title: "Editar paciente" };

export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { role } = await getTenantContext();
  const supabase = await createClient();
  const { id } = await params;

  const { data: patient } = await supabase
    .from("patients")
    .select("id, full_name, phone, email, notes, consent_at")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!patient) {
    notFound();
  }

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="heading text-2xl">Editar paciente</h1>
          <div className="flex gap-2">
            {can(role, "clinical") && (
              <Link
                href={`/dashboard/pacientes/${patient.id}/prontuario`}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                Prontuário
              </Link>
            )}
            <Link
              href={`/dashboard/agenda?patientId=${patient.id}`}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Nova consulta
            </Link>
          </div>
        </div>

        <Suspense fallback={null}>
          <Toast />
        </Suspense>

        <form action={updatePatient} className="card space-y-4 p-4">
          <input type="hidden" name="id" value={patient.id} />
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Nome completo</label>
            <input
              name="fullName"
              required
              defaultValue={patient.full_name}
              className="input w-full"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Telefone (DDD + número)</label>
            <input
              name="phone"
              required
              defaultValue={patient.phone}
              className="input w-full"
              placeholder="(11) 91234-5678"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">E-mail (opcional)</label>
            <input
              name="email"
              type="email"
              defaultValue={patient.email ?? ""}
              className="input w-full"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Observações (opcional)</label>
            <textarea
              name="notes"
              rows={3}
              defaultValue={patient.notes ?? ""}
              className="input w-full"
            />
          </div>
          <SubmitButton pendingText="Salvando...">Salvar alterações</SubmitButton>
        </form>

        {patient.consent_at ? (
          <p className="text-xs text-muted-soft">
            Consentimento (LGPD) registrado em{" "}
            {new Date(patient.consent_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
          </p>
        ) : (
          <form action={registerConsent} className="card space-y-2 p-4">
            <input type="hidden" name="patientId" value={patient.id} />
            <p className="text-sm font-medium text-ink">Consentimento (LGPD)</p>
            <label className="flex items-start gap-2 text-xs text-muted">
              <input type="checkbox" name="confirm" className="mt-0.5" />
              O paciente foi informado sobre o tratamento dos seus dados de saúde e concordou com o
              registro.
            </label>
            <SubmitButton pendingText="Registrando..." className="btn-secondary px-3 py-1.5 text-xs">
              Registrar consentimento
            </SubmitButton>
          </form>
        )}

        <form action={deletePatient}>
          <input type="hidden" name="id" value={patient.id} />
          <ConfirmSubmitButton
            confirmMessage="Remover este paciente? Dá pra desfazer em seguida."
            pendingText="Removendo..."
            className="text-sm font-medium text-red-600 hover:text-red-700"
          >
            Remover paciente
          </ConfirmSubmitButton>
        </form>
      </div>
    </main>
  );
}
