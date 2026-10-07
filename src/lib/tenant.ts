import type { SupabaseClient } from "@supabase/supabase-js";

// Garante que o usuário logado tem um tenant, provisionando um padrão
// na hora se faltar — nunca navega pra outra página pra fazer isso.
// Antes disso existia um redirect("/onboarding") em cada ponto que lia
// profile.tenant_id; isso criava um hop visível (carrega uma página,
// que então redireciona pra outra) logo depois do cadastro/login,
// sentido pelo usuário como "duas páginas carregando ao mesmo tempo".
// Desde a migration 0007, isso já não deveria faltar nunca (o tenant
// nasce no trigger de signup) — esta função é só a rede de segurança,
// resolvida sem sair da página atual.
export async function ensureTenantId(
  supabase: SupabaseClient,
  userId: string,
  fullName: string | null,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .single();

  if (profile?.tenant_id) {
    return profile.tenant_id as string;
  }

  const name = fullName?.trim() || "Minha Clínica";
  const slug =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "clinica";

  const { data: tenant, error } = await supabase
    .rpc("create_tenant_for_current_user", {
      tenant_name: name,
      tenant_slug: `${slug}-${userId.slice(0, 6)}`,
    })
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return (tenant as { id: string }).id;
}
