import type { Metadata } from "next";
import { createPublicClient } from "@/lib/supabase/public";
import { submitNps } from "@/lib/nps/actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Sua avaliação", robots: { index: false } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const { done, error } = await searchParams;

  const { data } = UUID_RE.test(token)
    ? await createPublicClient().rpc("get_nps_info", { p_token: token })
    : { data: null };
  const info = (data as { clinic_name: string; professional_name: string; answered: boolean }[] | null)?.[0];

  if (!info) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card w-full max-w-sm space-y-2 p-8 text-center">
          <h1 className="heading text-xl">Link indisponível</h1>
          <p className="text-sm text-muted">Esse link de avaliação não é válido.</p>
        </div>
      </main>
    );
  }

  if (done || info.answered) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card w-full max-w-sm space-y-2 p-8 text-center">
          <h1 className="heading text-xl">Obrigado!</h1>
          <p className="text-sm text-muted">Sua avaliação ajuda {info.clinic_name} a melhorar o atendimento.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={submitNps} className="card w-full max-w-md space-y-4 p-6">
        <input type="hidden" name="token" value={token} />
        <div>
          <h1 className="heading text-xl">Como foi seu atendimento?</h1>
          <p className="mt-1 text-sm text-muted">
            {info.clinic_name} · com {info.professional_name}
          </p>
        </div>
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">
            Qual a chance de você recomendar a clínica a um amigo?
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }, (_, n) => (
              <label key={n} className="cursor-pointer">
                <input type="radio" name="score" value={n} required className="peer sr-only" />
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-sm font-medium text-ink peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                  {n}
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-muted-soft">
            <span>0 = nenhuma chance</span>
            <span>10 = com certeza</span>
          </div>
        </fieldset>
        <div className="space-y-1">
          <label htmlFor="comment" className="text-sm font-medium text-ink">
            Quer deixar um comentário? <span className="font-normal text-muted-soft">(opcional)</span>
          </label>
          <textarea id="comment" name="comment" rows={3} maxLength={1000} className="input w-full" />
        </div>
        <SubmitButton pendingText="Enviando...">Enviar avaliação</SubmitButton>
      </form>
    </main>
  );
}
