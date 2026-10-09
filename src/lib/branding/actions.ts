"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureTenantId } from "@/lib/tenant";

const LOGO_BUCKET = "tenant-logos";
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB
// SVG fora de propósito: pode carregar <script> e é servido do domínio do storage.
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function uploadTenantLogo(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, full_name, tenants ( slug )")
    .eq("id", user.id)
    .single();

  // Rede de segurança: desde a migration 0007 isso não deveria faltar
  // nunca (o tenant nasce no trigger de signup), mas resolve aqui mesmo
  // em vez de redirecionar.
  const tenantId = profile?.tenant_id ?? (await ensureTenantId(supabase, user.id, profile?.full_name ?? null));
  const tenant = Array.isArray(profile?.tenants) ? profile.tenants[0] : profile?.tenants;

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    redirect(
      `/dashboard/agenda/configuracoes?error=${encodeURIComponent("Selecione um arquivo de imagem.")}`,
    );
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    redirect(
      `/dashboard/agenda/configuracoes?error=${encodeURIComponent(
        "Formato não suportado. Use PNG, JPG ou WEBP.",
      )}`,
    );
  }

  if (file.size > MAX_LOGO_BYTES) {
    redirect(
      `/dashboard/agenda/configuracoes?error=${encodeURIComponent("Imagem muito grande (máx. 2MB).")}`,
    );
  }

  // Pasta = tenant_id: é o que a policy de storage usa pra garantir que
  // uma clínica só escreve dentro da própria pasta (ver migration 0005).
  const path = `${tenantId}/logo-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600" });

  if (uploadError) {
    redirect(
      `/dashboard/agenda/configuracoes?error=${encodeURIComponent(uploadError.message)}`,
    );
  }

  const { data: publicUrlData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);

  const { data: updated, error: updateError } = await supabase
    .from("tenants")
    .update({ logo_url: publicUrlData.publicUrl })
    .eq("id", tenantId)
    .select("id");

  if (updateError || !updated?.length) {
    redirect(
      `/dashboard/agenda/configuracoes?error=${encodeURIComponent(
        updateError?.message ?? "Não foi possível salvar o logo.",
      )}`,
    );
  }

  revalidatePath("/dashboard/agenda/configuracoes");
  revalidatePath("/dashboard");
  if (tenant?.slug) {
    revalidatePath(`/agendar/${tenant.slug}`);
  }
  redirect(
    `/dashboard/agenda/configuracoes?success=${encodeURIComponent("Logo atualizado.")}`,
  );
}
