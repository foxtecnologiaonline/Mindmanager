import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { deletePatient, updatePatient } from "@/lib/patients/actions";

export const metadata: Metadata = { title: "Editar paciente" };

export default async function EditPatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;

  const { data: patient } = await supabase
    .from("patients")
    .select("id, full_name, phone, email, notes")
    .eq("id", id)
    .single();

  if (!patient) {
    notFound();
  }

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="heading text-2xl">Editar paciente</h1>
          <Link href="/dashboard/pacientes" className="link-accent text-sm">
            Voltar
          </Link>
        </div>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

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

        <form action={deletePatient}>
          <input type="hidden" name="id" value={patient.id} />
          <SubmitButton
            pendingText="Removendo..."
            className="text-sm font-medium text-red-600 hover:text-red-700"
          >
            Remover paciente
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
