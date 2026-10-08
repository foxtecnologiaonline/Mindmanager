import type { Metadata } from "next";
import Image from "next/image";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { BookingForm } from "./booking-form";

// get_booking_info é uma RPC pública (security definer, sem depender de
// sessão/cookies) — cachear por 60s evita bater no Supabase a cada
// visita da página de agendamento, que tende a receber picos de acesso
// quando a clínica divulga o link.
export const revalidate = 60;

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

// generateMetadata e o page component abaixo precisam dos mesmos dados.
// supabase.rpc() faz um POST, então a deduplicação automática de fetch do
// Next (que só cobre GET) não entra em ação aqui — sem isso bateríamos no
// Supabase duas vezes por request. `cache()` do React memoiza por
// argumentos dentro do mesmo ciclo de renderização, cobrindo as duas
// chamadas com uma RPC só.
const getBookingInfo = cache(async (slug: string) => {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_booking_info", {
    p_tenant_slug: slug,
  });

  if (error || !data || data.length === 0) {
    return null;
  }

  return data as BookingInfoRow[];
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const rows = await getBookingInfo(slug);

  if (!rows) {
    return { title: "Clínica não encontrada" };
  }

  const tenantName = rows[0].tenant_name;
  const description = `Agende sua consulta online com ${tenantName}.`;

  return {
    title: tenantName,
    description,
    openGraph: {
      title: tenantName,
      description,
      images: rows[0].tenant_logo_url ? [rows[0].tenant_logo_url] : undefined,
    },
  };
}

export default async function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const rows = await getBookingInfo(slug);

  if (!rows) {
    notFound();
  }

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
          <div className="relative h-14 w-40">
            <Image
              src={tenantLogoUrl}
              alt={`Logo de ${tenantName}`}
              fill
              className="object-contain object-left"
            />
          </div>
        )}
        <h1 className="heading text-2xl">{tenantName}</h1>
        <p className="text-sm text-muted">Agende sua consulta online.</p>
        <BookingForm tenantSlug={slug} services={services} />
      </div>
    </main>
  );
}
