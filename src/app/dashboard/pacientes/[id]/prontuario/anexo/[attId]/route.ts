import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { logger } from "@/lib/logger";

// Download de anexo do prontuário: confere permissão (RLS + papel),
// registra o acesso na trilha de auditoria e redireciona para uma URL
// assinada que vale 60 segundos — o bucket é privado.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attId: string }> },
) {
  const { id: patientId, attId } = await params;
  const { role } = await getTenantContext();

  if (!can(role, "clinical")) {
    return new NextResponse("Sem permissão.", { status: 403 });
  }

  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("patient_attachments")
    .select("id, storage_path, file_name, patient_id")
    .eq("id", attId)
    .eq("patient_id", patientId)
    .is("deleted_at", null)
    .single();

  if (!attachment) {
    return new NextResponse("Anexo não encontrado.", { status: 404 });
  }

  const { error: auditError } = await supabase.rpc("log_access", {
    p_action: "attachment.download",
    p_entity: "patient_attachment",
    p_entity_id: attachment.id,
    p_patient_id: patientId,
    p_metadata: { file_name: attachment.file_name },
  });
  if (auditError) {
    // Sem trilha, sem download: o acesso a dado de saúde tem que ficar registrado.
    logger.error("clinical.audit_failed", auditError);
    return new NextResponse("Não foi possível registrar o acesso.", { status: 500 });
  }

  const { data: signed, error } = await supabase.storage
    .from("patient-files")
    .createSignedUrl(attachment.storage_path, 60, { download: attachment.file_name });

  if (error || !signed) {
    logger.error("clinical.signed_url_failed", error);
    return new NextResponse("Arquivo indisponível.", { status: 404 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
