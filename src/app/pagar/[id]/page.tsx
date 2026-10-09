import type { Metadata } from "next";
import Image from "next/image";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { buildPixPayload } from "@/lib/billing/pix";
import { CopyLinkButton } from "@/components/copy-link-button";

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// generateMetadata e o page component abaixo chamam isso com o mesmo
// id — supabase.rpc() é POST, então o memoization automático de fetch
// do Next (só cobre GET) não dedupe essas duas chamadas por conta
// própria; cache() do React garante uma RPC só por request (mesmo
// padrão de src/app/agendar/[slug]/page.tsx).
const getPaymentLinkInfo = cache(async (id: string) => {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_payment_link_info", { p_link_id: id }).single();

  if (error || !data) {
    return null;
  }

  return data as {
    amount_cents: number;
    status: string;
    tenant_name: string;
    tenant_logo_url: string | null;
    pix_key: string | null;
    pix_holder_name: string | null;
    pix_city: string | null;
  };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const info = await getPaymentLinkInfo(id);
  return { title: info ? `Pagamento · ${info.tenant_name}` : "Link de pagamento" };
}

export default async function PaymentLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const info = await getPaymentLinkInfo(id);

  if (!info) {
    notFound();
  }

  const pixReady = Boolean(info.pix_key && info.pix_holder_name && info.pix_city);
  const pixPayload = pixReady
    ? buildPixPayload({
        pixKey: info.pix_key!,
        merchantName: info.pix_holder_name!,
        merchantCity: info.pix_city!,
        amountCents: info.amount_cents,
        txId: id.replace(/-/g, ""),
      })
    : null;

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-md space-y-6">
        <div className="card space-y-4 p-6 text-center">
          {info.tenant_logo_url && (
            <Image
              src={info.tenant_logo_url}
              alt={`Logo de ${info.tenant_name}`}
              width={56}
              height={56}
              className="mx-auto rounded-lg border border-border object-contain"
            />
          )}
          <h1 className="heading text-xl">{info.tenant_name}</h1>

          {info.status !== "open" ? (
            <p className="rounded-lg bg-accent-soft p-3 text-sm text-ink">
              {info.status === "paid" ? "Este pagamento já foi confirmado." : "Este link foi cancelado."}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-soft">Valor a pagar</p>
              <p className="text-3xl font-semibold text-ink">{formatCents(info.amount_cents)}</p>

              {pixPayload ? (
                <div className="space-y-2 text-left">
                  <p className="text-sm font-medium text-ink">Pague com Pix (copia e cola)</p>
                  <code className="block break-all rounded-lg border border-border bg-paper p-3 text-xs">
                    {pixPayload}
                  </code>
                  <CopyLinkButton text={pixPayload} label="Copiar código Pix" />
                  <p className="text-xs text-muted-soft">
                    Abra o app do seu banco, escolha &quot;Pix Copia e Cola&quot; e cole o código
                    acima.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-soft">
                  A clínica ainda não configurou uma chave Pix para receber por este link — fale
                  diretamente com a clínica para pagar.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
