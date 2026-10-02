import { headers } from "next/headers";
import { createPublicClient } from "@/lib/supabase/public";

export async function getClientIp() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

// Backed pela função SQL check_rate_limit (migration 0005): atômico
// mesmo com múltiplas instâncias serverless, ao contrário de um contador
// em memória (que não sobrevive entre invocações da Vercel — cada
// request pode cair numa instância fria diferente).
export async function checkRateLimit(key: string, limit: number, windowSeconds: number) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Falha "aberta": se a checagem não puder rodar (ex: migration 0005
    // ainda não aplicada), não bloqueia o fluxo principal de agendamento.
    console.error("[rate-limit]", error.message);
    return true;
  }

  return data === true;
}
