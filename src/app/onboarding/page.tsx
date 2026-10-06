import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Desde a migration 0007, o tenant nasce automaticamente no signup
// (trigger handle_new_user) — não existe mais pergunta de "nome da
// clínica" aqui. Esta página só sobra como fallback de segurança para
// contas criadas antes da 0007 (ou qualquer linha que escape do
// trigger por algum motivo): provisiona um tenant padrão sem perguntar
// nada e manda direto pro dashboard.
export default async function OnboardingPage() {
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

  if (!profile?.tenant_id) {
    const name = profile?.full_name?.trim() || "Minha Clínica";
    const slug =
      name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "clinica";

    await supabase.rpc("create_tenant_for_current_user", {
      tenant_name: name,
      tenant_slug: `${slug}-${user.id.slice(0, 6)}`,
    });
  }

  redirect("/dashboard");
}
