import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stripDiacritics } from "@/lib/text";

// Normaliza um nome em slug ascii-kebab (ex: "Clínica São José" ->
// "clinica-sao-jose"). Compartilhado entre o fallback aqui e
// /onboarding (mesmo cálculo que antes vivia duplicado nos dois
// lugares).
export function slugify(name: string): string {
  return (
    stripDiacritics(name.toLowerCase())
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "clinica"
  );
}

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
  const slug = slugify(name);

  const { data: tenant, error } = await supabase
    .rpc("create_tenant_for_current_user", {
      tenant_name: name,
      tenant_slug: `${slug}-${userId.slice(0, 6)}`,
    })
    .single();

  if (error) {
    // Defesa extra: se outra chamada concorrente criou o tenant entre o
    // select acima e este insert, a RPC recusa com "já pertence a uma
    // clínica" — relê antes de desistir, em vez de derrubar a página.
    const { data: retried } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();

    if (retried?.tenant_id) {
      return retried.tenant_id as string;
    }

    throw new Error(error.message);
  }

  return (tenant as { id: string }).id;
}

// Atalho para quem só precisa do tenant_id (sem outras colunas do
// profile): faz a leitura e já aplica o fallback acima numa chamada só,
// em vez de cada call site reimplementar "select tenant_id -> se faltar,
// ensureTenantId" na mão.
export async function requireTenantId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, full_name")
    .eq("id", userId)
    .single();

  return profile?.tenant_id ?? (await ensureTenantId(supabase, userId, profile?.full_name ?? null));
}

export type TenantContext = {
  userId: string;
  tenantId: string;
  fullName: string;
  role: string;
  tenantName: string | null;
  tenantSlug: string | null;
  logoUrl: string | null;
};

// Auth + perfil + tenant, numa chamada só, memoizada por request via
// cache() do React — chamada de novo em cada página sob /dashboard (e
// no layout compartilhado) sem repetir a ida ao banco: mesmo request,
// mesmo resultado. Cada página continua checando a sessão (defesa em
// profundidade, não só confiar no layout pai), só que sem pagar a ida
// ao banco de novo.
export const getTenantContext = cache(async (): Promise<TenantContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profileQuery = () =>
    supabase
      .from("profiles")
      .select("full_name, role, tenant_id, tenants ( name, slug, logo_url )")
      .eq("id", user.id)
      .single();

  let { data: profile } = await profileQuery();

  if (!profile?.tenant_id) {
    await ensureTenantId(supabase, user.id, profile?.full_name ?? null);
    ({ data: profile } = await profileQuery());
  }

  const tenant = Array.isArray(profile!.tenants) ? profile!.tenants[0] : profile!.tenants;

  return {
    userId: user.id,
    tenantId: profile!.tenant_id as string,
    fullName: profile!.full_name as string,
    role: profile!.role as string,
    tenantName: tenant?.name ?? null,
    tenantSlug: tenant?.slug ?? null,
    logoUrl: tenant?.logo_url ?? null,
  };
});
