import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { BookingForm } from "./booking-form";

// get_booking_info é uma RPC pública (security definer, sem depender de
// sessão/cookies) — cachear por 60s evita bater no Supabase a cada
// visita da página de agendamento, que tende a receber picos de acesso
// quando a clínica divulga o link.
export const revalidate = 60;

export default async function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_booking_info", {
    p_tenant_slug: slug,
  });

  if (error || !data || data.length === 0) {
    notFound();
  }

  type BookingInfoRow = {
    tenant_name: string;
    tenant_logo_url: string | null;
    professional_id: string;
    professional_name: string;
    service_type_id: string;
    service_name: string;
    duration_minutes: number;
    price_cents: number | null;
  };

  const rows = data as BookingInfoRow[];
  const tenantName = rows[0].tenant_name;
  const tenantLogoUrl = rows[0].tenant_logo_url;

  const services = rows.map((row) => ({
    professionalId: row.professional_id,
    professionalName: row.professional_name,
    serviceTypeId: row.service_type_id,
    serviceName: row.service_name,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
  }));

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-lg space-y-6">
        {tenantLogoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- logo de tenant arbitrário, sem domínio fixo pra configurar no next.config
          <img
            src={tenantLogoUrl}
            alt={`Logo de ${tenantName}`}
            className="h-14 w-auto object-contain"
          />
        )}
        <h1 className="heading text-2xl">{tenantName}</h1>
        <p className="text-sm text-muted">Agende sua consulta online.</p>
        <BookingForm tenantSlug={slug} services={services} />
      </div>
    </main>
  );
}
