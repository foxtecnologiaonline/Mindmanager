"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { requireCapability, can } from "@/lib/permissions";
import {
  cleanFileName,
  EXTENSION_BY_MIME,
  MAX_ATTACHMENT_BYTES,
  sniffMime,
} from "@/lib/clinical/files";

const MAX_FIELD = 20000;

async function requireClinical() {
  const ctx = await getTenantContext();
  requireCapability(ctx.role, "clinical");
  return { ...ctx, supabase: await createClient() };
}

function back(patientId: string, kind: "error" | "success", message: string): never {
  redirect(`/dashboard/pacientes/${patientId}/prontuario?${kind}=${encodeURIComponent(message)}`);
}

// Consentimento (LGPD): registrado pela equipe, uma vez por paciente.
// Recepção também pode registrar (é quem recebe o paciente), por isso não
// exige a capacidade "clinical".
export async function registerConsent(formData: FormData) {
  const { supabase, tenantId, userId, role } = await getTenantContext().then(async (c) => ({
    ...c,
    supabase: await createClient(),
  }));
  const patientId = String(formData.get("patientId") ?? "");
  // Quem não vê prontuário (recepção) volta para o cadastro do paciente.
  const returnPath = can(role, "clinical")
    ? `/dashboard/pacientes/${patientId}/prontuario`
    : `/dashboard/pacientes/${patientId}`;
  const done = (kind: "error" | "success", message: string): never =>
    redirect(`${returnPath}?${kind}=${encodeURIComponent(message)}`);

  if (formData.get("confirm") !== "on") {
    done("error", "Marque a confirmação para registrar o consentimento.");
  }
  if (!can(role, "clinical") && role !== "recepcao") {
    done("error", "Sem permissão.");
  }

  const { data, error } = await supabase
    .from("patients")
    .update({ consent_at: new Date().toISOString(), consent_recorded_by: userId })
    .eq("id", patientId)
    .eq("tenant_id", tenantId)
    .is("consent_at", null)
    .select("id");

  if (error || !data?.length) {
    done("error", error?.message ?? "Consentimento já registrado ou paciente não encontrado.");
  }

  revalidatePath(returnPath);
  done("success", "Consentimento registrado.");
}

type NoteFields = { subjective: string; objective: string; assessment: string; plan: string };

function readNoteFields(formData: FormData): NoteFields {
  const read = (k: string) => String(formData.get(k) ?? "").trim();
  return {
    subjective: read("subjective"),
    objective: read("objective"),
    assessment: read("assessment"),
    plan: read("plan"),
  };
}

function hasContent(f: NoteFields) {
  return Object.values(f).some((v) => v.length > 0);
}

function tooLong(f: NoteFields) {
  return Object.values(f).some((v) => v.length > MAX_FIELD);
}

// Cria ou atualiza o RASCUNHO e, se `intent=sign`, assina em seguida.
// Evolução assinada é imutável no banco; correção é adendo (parentId).
export async function saveNote(formData: FormData) {
  const { supabase, tenantId, userId } = await requireClinical();

  const patientId = String(formData.get("patientId") ?? "");
  const noteId = String(formData.get("noteId") ?? "");
  const parentId = String(formData.get("parentId") ?? "");
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const intent = String(formData.get("intent") ?? "draft");
  const fields = readNoteFields(formData);

  if (!hasContent(fields)) back(patientId, "error", "Preencha ao menos um campo da evolução.");
  if (tooLong(fields)) back(patientId, "error", "Texto muito longo (máx. 20.000 caracteres por campo).");

  let id = noteId;

  if (id) {
    const { data, error } = await supabase
      .from("clinical_notes")
      .update(fields)
      .eq("id", id)
      .eq("status", "draft")
      .select("id");
    if (error || !data?.length) {
      back(patientId, "error", error?.message ?? "Esse rascunho não pode mais ser editado.");
    }
  } else {
    const { data: patient } = await supabase
      .from("patients")
      .select("consent_at")
      .eq("id", patientId)
      .eq("tenant_id", tenantId)
      .single();
    if (!patient?.consent_at) {
      back(patientId, "error", "Registre o consentimento do paciente antes de criar evoluções.");
    }

    const { data, error } = await supabase
      .from("clinical_notes")
      .insert({
        tenant_id: tenantId,
        patient_id: patientId,
        author_id: userId,
        appointment_id: appointmentId || null,
        parent_id: parentId || null,
        ...fields,
      })
      .select("id")
      .single();
    if (error || !data) back(patientId, "error", error?.message ?? "Não foi possível salvar.");
    id = data!.id as string;
  }

  if (intent === "sign") {
    const { error } = await supabase
      .from("clinical_notes")
      .update({ status: "signed" })
      .eq("id", id)
      .eq("status", "draft");
    if (error) back(patientId, "error", error.message);
    revalidatePath(`/dashboard/pacientes/${patientId}/prontuario`);
    back(patientId, "success", "Evolução assinada. Ela não pode mais ser alterada.");
  }

  revalidatePath(`/dashboard/pacientes/${patientId}/prontuario`);
  back(patientId, "success", "Rascunho salvo.");
}

export async function deleteDraft(formData: FormData) {
  const { supabase } = await requireClinical();
  const patientId = String(formData.get("patientId") ?? "");
  const noteId = String(formData.get("noteId") ?? "");

  const { error } = await supabase.from("clinical_notes").delete().eq("id", noteId).eq("status", "draft");
  if (error) back(patientId, "error", error.message);

  revalidatePath(`/dashboard/pacientes/${patientId}/prontuario`);
  back(patientId, "success", "Rascunho apagado.");
}

export async function uploadAttachment(formData: FormData) {
  const { supabase, tenantId, userId } = await requireClinical();

  const patientId = String(formData.get("patientId") ?? "");
  const description = String(formData.get("description") ?? "").trim().slice(0, 300);
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) back(patientId, "error", "Selecione um arquivo.");
  if (file.size > MAX_ATTACHMENT_BYTES) back(patientId, "error", "Arquivo muito grande (máx. 10 MB).");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) back(patientId, "error", "Formato não aceito. Envie PDF, PNG, JPG ou WEBP.");

  const storagePath = `${tenantId}/${patientId}/${randomUUID()}.${EXTENSION_BY_MIME[mime!]}`;

  // Linha primeiro (RLS confere paciente/clínica); se o upload falhar, a
  // linha é marcada como removida — o storage não tem policy de delete.
  const { data: row, error: insertError } = await supabase
    .from("patient_attachments")
    .insert({
      tenant_id: tenantId,
      patient_id: patientId,
      uploaded_by: userId,
      file_name: cleanFileName(file.name),
      storage_path: storagePath,
      mime_type: mime!,
      size_bytes: file.size,
      description: description || null,
    })
    .select("id")
    .single();
  if (insertError || !row) back(patientId, "error", insertError?.message ?? "Não foi possível anexar.");

  const { error: uploadError } = await supabase.storage
    .from("patient-files")
    .upload(storagePath, bytes, { contentType: mime!, upsert: false });

  if (uploadError) {
    await supabase
      .from("patient_attachments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row!.id);
    back(patientId, "error", `Falha no upload: ${uploadError.message}`);
  }

  revalidatePath(`/dashboard/pacientes/${patientId}/prontuario`);
  back(patientId, "success", "Arquivo anexado.");
}

export async function removeAttachment(formData: FormData) {
  const { supabase } = await requireClinical();
  const patientId = String(formData.get("patientId") ?? "");
  const id = String(formData.get("id") ?? "");

  const { data, error } = await supabase
    .from("patient_attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error || !data?.length) back(patientId, "error", error?.message ?? "Não foi possível remover.");

  revalidatePath(`/dashboard/pacientes/${patientId}/prontuario`);
  back(patientId, "success", "Anexo removido da lista (o arquivo é mantido por exigência de retenção).");
}
