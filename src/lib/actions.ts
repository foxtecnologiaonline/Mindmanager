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
    // Ecoa nome+e-mail (nunca a senha) pra não ter que redigitar tudo
    // de novo só porque, por exemplo, a senha era curta demais.
    redirect(
      `/signup?error=${encodeURIComponent(error.message)}&fullName=${encodeURIComponent(fullName)}&email=${encodeURIComponent(email)}`,
    );
  }

  // Projetos Supabase com "confirmar e-mail" ativado não criam sessão aqui:
  // o usuário só autentica de fato ao clicar no link recebido por e-mail.
  // Desative "Confirm email" em Authentication > Providers > Email no
  // painel do Supabase se quiser pular esse passo (entra direto).
  if (!data.session) {
    redirect("/signup?checkEmail=1");
  }

  // O tenant já nasce junto no trigger de signup (migration 0007) — vai
  // direto pro dashboard, sem pergunta de onboarding no meio.
  redirect("/dashboard");
}

export async function login(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Ecoa o e-mail (nunca a senha) — errar a senha não deveria obrigar
    // a redigitar o e-mail também.
    redirect(
      `/login?error=${encodeURIComponent(error.message)}&email=${encodeURIComponent(email)}`,
    );
  }

  redirect("/dashboard");
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email"));

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/redefinir-senha`,
  });

  // Não revelamos se o e-mail existe ou não (evita enumeração de contas) —
  // sempre mostramos a mesma mensagem, só logamos erro real no servidor.
  if (error) {
    console.error("[requestPasswordReset]", error.message);
  }

  redirect("/esqueci-senha?sent=1");
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(`/redefinir-senha?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/dashboard?passwordUpdated=1");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
