"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenantId } from "@/lib/tenant";
import { requireCapability } from "@/lib/permissions";
import { getTenantContext } from "@/lib/tenant";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/billing/payment-method";

const RECURRENCES = ["avulso", "pacote", "mensal"] as const;

async function requireFinanceTenant() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { role } = await getTenantContext();
  requireCapability(role, "finance");

  const tenantId = await requireTenantId(supabase, user.id);

  return { supabase, tenantId, userId: user.id };
}

export async function updatePatientBillingProfile(formData: FormData) {
  const patientId = String(formData.get("patientId") ?? "");
  const { supabase, tenantId, userId } = await requireFinanceTenant();

  const methodRaw = String(formData.get("preferredPaymentMethod") ?? "");
  const preferredPaymentMethod: PaymentMethod | null = (PAYMENT_METHODS as readonly string[]).includes(
    methodRaw,
  )
    ? (methodRaw as PaymentMethod)
    : null;

  const recurrenceRaw = String(formData.get("billingRecurrence") ?? "avulso");
  const billingRecurrence = (RECURRENCES as readonly string[]).includes(recurrenceRaw)
    ? recurrenceRaw
    : "avulso";

  const billingNotes = String(formData.get("billingNotes") ?? "").trim();

  if (!patientId || billingNotes.length > 300) {
    redirect(
      `/dashboard/pacientes/${patientId}/financeiro?error=${encodeURIComponent(
        "Dados inválidos.",
      )}`,
    );
  }

  const { error } = await supabase.from("patient_billing_profiles").upsert({
    patient_id: patientId,
    tenant_id: tenantId,
    preferred_payment_method: preferredPaymentMethod,
    billing_recurrence: billingRecurrence,
    billing_notes: billingNotes || null,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });

  if (error) {
    redirect(
      `/dashboard/pacientes/${patientId}/financeiro?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath(`/dashboard/pacientes/${patientId}/financeiro`);
  redirect(
    `/dashboard/pacientes/${patientId}/financeiro?success=${encodeURIComponent(
      "Preferências de cobrança salvas.",
    )}`,
  );
}
