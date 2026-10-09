"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenantId as resolveTenantId } from "@/lib/tenant";
import { isValidBrazilPhone } from "@/lib/scheduling/validation";

async function requireTenantId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tenantId = await resolveTenantId(supabase, user.id);

  return { supabase, tenantId };
}

export async function createPatient(formData: FormData) {
  const { supabase, tenantId } = await requireTenantId();

  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!fullName || !isValidBrazilPhone(phone)) {
    redirect(
      `/dashboard/pacientes/novo?error=${encodeURIComponent(
        "Preencha o nome e um telefone válido (DDD + número).",
      )}`,
    );
  }

  const { error } = await supabase.from("patients").insert({
    tenant_id: tenantId,
    full_name: fullName,
    phone,
    email: email || null,
    notes: notes || null,
  });

  if (error) {
    redirect(`/dashboard/pacientes/novo?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/pacientes");
  redirect(
    `/dashboard/pacientes?success=${encodeURIComponent("Paciente cadastrado.")}`,
  );
}

export async function updatePatient(formData: FormData) {
  const { supabase } = await requireTenantId();

  const id = String(formData.get("id"));
  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!fullName || !isValidBrazilPhone(phone)) {
    redirect(
      `/dashboard/pacientes/${id}?error=${encodeURIComponent(
        "Preencha o nome e um telefone válido (DDD + número).",
      )}`,
    );
  }

  const { error } = await supabase
    .from("patients")
    .update({
      full_name: fullName,
      phone,
      email: email || null,
      notes: notes || null,
    })
    .eq("id", id);

  if (error) {
    redirect(`/dashboard/pacientes/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/pacientes");
  redirect(
    `/dashboard/pacientes?success=${encodeURIComponent("Paciente atualizado.")}`,
  );
}

export async function deletePatient(formData: FormData) {
  const { supabase } = await requireTenantId();
  const id = String(formData.get("id"));

  // Soft delete: marca deleted_at em vez de apagar de verdade — dá pra
  // desfazer pelo toast, e mantém o histórico de consultas já ligadas
  // a esse paciente (patient_id em appointments) intacto.
  const { error } = await supabase
    .from("patients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/dashboard/pacientes");

  if (error) {
    redirect(`/dashboard/pacientes?error=${encodeURIComponent(error.message)}`);
  }

  redirect(
    `/dashboard/pacientes?success=${encodeURIComponent("Paciente removido.")}&undoPatientId=${id}`,
  );
}

export async function undoDeletePatient(formData: FormData) {
  const { supabase } = await requireTenantId();
  const id = String(formData.get("id"));

  await supabase.from("patients").update({ deleted_at: null }).eq("id", id);

  revalidatePath("/dashboard/pacientes");
  redirect(`/dashboard/pacientes?success=${encodeURIComponent("Remoção desfeita.")}`);
}
