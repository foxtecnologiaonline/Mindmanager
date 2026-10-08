import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { createPatient } from "@/lib/patients/actions";

export const metadata: Metadata = { title: "Novo paciente" };

export default async function NewPatientPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="heading text-2xl">Novo paciente</h1>
          <Link href="/dashboard/pacientes" className="link-accent text-sm">
            Voltar
          </Link>
        </div>

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
