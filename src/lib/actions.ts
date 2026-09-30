"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

export async function signup(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const fullName = String(formData.get("fullName"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${await siteUrl()}/auth/confirm`,
    },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // Projetos Supabase com "confirmar e-mail" ativado não criam sessão aqui:
  // o usuário só autentica de fato ao clicar no link recebido por e-mail.
  if (!data.session) {
    redirect("/signup?checkEmail=1");
  }

  redirect("/onboarding");
}

export async function login(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createTenant(formData: FormData) {
  const name = String(formData.get("name"));
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Insert de tenant + vínculo do profile acontecem numa única transação
  // no banco (função security definer), evitando tenant órfão em caso de
  // falha parcial e o problema de RLS filtrar o RETURNING do insert.
  const { error: rpcError } = await supabase.rpc(
    "create_tenant_for_current_user",
    { tenant_name: name, tenant_slug: `${slug}-${user.id.slice(0, 6)}` },
  );

  if (rpcError) {
    redirect(`/onboarding?error=${encodeURIComponent(rpcError.message)}`);
  }

  redirect("/dashboard");
}
