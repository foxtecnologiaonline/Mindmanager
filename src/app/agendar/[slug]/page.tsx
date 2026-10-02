import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BookingForm } from "./booking-form";

export default async function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_booking_info", {
    p_tenant_slug: slug,
  });

  if (error || !data || data.length === 0) {
    notFound();
  }

  type BookingInfoRow = {
    tenant_name: string;
    professional_id: string;
    professional_name: string;
    service_type_id: string;
    service_name: string;
    duration_minutes: number;
    price_cents: number | null;
  };

  const rows = data as BookingInfoRow[];
  const tenantName = rows[0].tenant_name;

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
        <h1 className="heading text-2xl">{tenantName}</h1>
        <p className="text-sm text-muted">Agende sua consulta online.</p>
        <BookingForm tenantSlug={slug} services={services} />
      </div>
    </main>
  );
}
