import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { DashboardNav } from "@/components/dashboard-nav";

// Layout compartilhado por tudo sob /dashboard: sidebar fixa no desktop,
// tab bar no rodapé no mobile — antes disso cada página reimplementava
// seus próprios links de volta/avançar (Pacientes, Configurar, Voltar),
// cada uma de um jeito ligeiramente diferente.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { tenantId, tenantName, logoUrl, fullName } = await getTenantContext();
  const supabase = await createClient();

  // Lista leve (nome + telefone) pra busca global na sidebar — filtrada
  // no cliente, sem round-trip por tecla digitada.
  const { data: patients } = await supabase
    .from("patients")
    .select("id, full_name, phone")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("full_name");

  return (
    <div className="flex min-h-screen">
      <DashboardNav
        tenantName={tenantName}
        logoUrl={logoUrl}
        fullName={fullName}
        patients={(patients ?? []).map((p) => ({ id: p.id, fullName: p.full_name, phone: p.phone }))}
      />
      <div className="flex-1 pb-16 md:pb-0">{children}</div>
    </div>
  );
}
