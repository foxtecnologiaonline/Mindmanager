import type { Metadata } from "next";
import { Suspense } from "react";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { createPatient } from "@/lib/patients/actions";
import { getTenantContext } from "@/lib/tenant";

export const metadata: Metadata = { title: "Novo paciente" };

export default async function NewPatientPage() {
  await getTenantContext();

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-md space-y-6">
        <h1 className="heading text-2xl">Novo paciente</h1>

        <Suspense fallback={null}>
          <Toast />
        </Suspense>

        <form action={createPatient} className="card space-y-4 p-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Nome completo</label>
            <input name="fullName" required className="input w-full" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Telefone (DDD + número)</label>
            <input name="phone" required className="input w-full" placeholder="(11) 91234-5678" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">E-mail (opcional)</label>
            <input name="email" type="email" className="input w-full" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Observações (opcional)</label>
            <textarea name="notes" rows={3} className="input w-full" />
          </div>
          <SubmitButton pendingText="Cadastrando...">Cadastrar paciente</SubmitButton>
        </form>
      </div>
    </main>
  );
}
