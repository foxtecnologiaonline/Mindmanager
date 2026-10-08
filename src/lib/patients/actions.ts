"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureTenantId } from "@/lib/tenant";
import { isValidBrazilPhone } from "@/lib/scheduling/validation";

async function requireTenantId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, full_name")
    .eq("id", user.id)
    .single();

  const tenantId = profile?.tenant_id ?? (await ensureTenantId(supabase, user.id, profile?.full_name ?? null));

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

  await supabase.from("patients").delete().eq("id", id);

  revalidatePath("/dashboard/pacientes");
  redirect(
    `/dashboard/pacientes?success=${encodeURIComponent("Paciente removido.")}`,
  );
}
