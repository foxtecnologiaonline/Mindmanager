"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const ZAPSCRIPT_BASE_URL = process.env.ZAPSCRIPT_BASE_URL || "https://api.zapscript.me";

type ZapscriptNumber = {
  id: string;
  phoneNumber: string;
  status: string;
  connected: boolean;
};

async function requireAdminProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) {
    redirect("/onboarding");
  }

  if (profile.role !== "admin") {
    throw new Error("Apenas administradores podem configurar o WhatsApp da clínica.");
  }

  return { supabase, tenantId: profile.tenant_id as string };
}

// Lista os números já conectados na conta ZapScript dessa API key — a
// conexão em si (pareamento do WhatsApp, QR code) acontece no painel do
// ZapScript, fora do MindManager; aqui só lemos o resultado.
export async function listOwnZapscriptNumbers(apiKey: string) {
  await requireAdminProfile();

  if (!apiKey.trim()) {
    return { numbers: [] as ZapscriptNumber[], error: "Informe a API key." };
  }

  try {
    const response = await fetch(`${ZAPSCRIPT_BASE_URL}/public/v1/numbers`, {
      headers: { "X-Api-Key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        numbers: [] as ZapscriptNumber[],
        error: `ZapScript recusou a API key (código ${response.status}).`,
      };
    }

    const json = (await response.json()) as { data?: ZapscriptNumber[] };
    return { numbers: json.data ?? [], error: null };
  } catch {
    return {
      numbers: [] as ZapscriptNumber[],
      error: "Não foi possível consultar o ZapScript agora. Tente de novo.",
    };
  }
}

// Registra o webhook de resposta (POST /public/v1/webhooks, com a API
// key da própria clínica) numa URL dedicada a este tenant, e salva tudo
// — a partir daqui o envio/recebimento desse tenant passa a usar o
// número próprio em vez do compartilhado da plataforma.
export async function connectOwnWhatsapp(input: { apiKey: string; numberId: string }) {
  const { supabase, tenantId } = await requireAdminProfile();

  if (!input.apiKey.trim() || !input.numberId.trim()) {
    return { success: false as const, error: "Informe a API key e escolha um número." };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return {
      success: false as const,
      error: "NEXT_PUBLIC_SITE_URL não está configurado no ambiente — não dá pra registrar o webhook.",
    };
  }

  let secret: string | undefined;
  try {
    const response = await fetch(`${ZAPSCRIPT_BASE_URL}/public/v1/webhooks`, {
      method: "POST",
      headers: { "X-Api-Key": input.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${siteUrl}/api/webhooks/zapscript/${tenantId}`,
        events: ["message.received"],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        success: false as const,
        error: `ZapScript recusou o registro do webhook (código ${response.status}): ${errorBody || "sem detalhes"}`,
      };
    }

    const json = (await response.json()) as { secret?: string };
    secret = json.secret;
  } catch {
    return {
      success: false as const,
      error: "Falha ao falar com o ZapScript. Confira a API key e tente de novo.",
    };
  }

  if (!secret) {
    return {
      success: false as const,
      error: "ZapScript não devolveu o secret do webhook. Tente de novo.",
    };
  }

  const { error } = await supabase
    .from("tenants")
    .update({
      whatsapp_mode: "own",
      whatsapp_api_key: input.apiKey,
      whatsapp_number_id: input.numberId,
      whatsapp_webhook_secret: secret,
    })
    .eq("id", tenantId);

  if (error) {
    return { success: false as const, error: error.message };
  }

  revalidatePath("/dashboard/agenda/configuracoes");
  return { success: true as const, error: null };
}

// Volta para o número compartilhado da plataforma e limpa as
// credenciais próprias — evita manter uma API key de terceiro
// armazenada depois que o tenant parou de usá-la.
export async function disconnectOwnWhatsapp() {
  const { supabase, tenantId } = await requireAdminProfile();

  const { error } = await supabase
    .from("tenants")
    .update({
      whatsapp_mode: "shared",
      whatsapp_api_key: null,
      whatsapp_number_id: null,
      whatsapp_webhook_secret: null,
    })
    .eq("id", tenantId);

  if (error) {
    return { success: false as const, error: error.message };
  }

  revalidatePath("/dashboard/agenda/configuracoes");
  return { success: true as const, error: null };
}
