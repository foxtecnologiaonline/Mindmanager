"use server";

import { redirect } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitNps(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const score = Number(formData.get("score"));
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 1000);

  const to = (query: string) => redirect(`/nps/${encodeURIComponent(token)}?${query}`);

  if (!UUID_RE.test(token)) redirect("/");
  if (!Number.isInteger(score) || score < 0 || score > 10) to("error=" + encodeURIComponent("Escolha uma nota de 0 a 10."));

  const ip = await getClientIp();
  if (!(await checkRateLimit(`nps:${ip}`, 10, 600))) {
    to("error=" + encodeURIComponent("Muitas tentativas. Aguarde alguns minutos."));
  }

  const { error } = await createPublicClient().rpc("submit_nps", {
    p_token: token,
    p_score: score,
    p_comment: comment || null,
  });

  if (error) to("error=" + encodeURIComponent("Não foi possível enviar sua avaliação."));

  to("done=1");
}
