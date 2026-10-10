"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { checkRateLimit, getClientIp, hashKey } from "@/lib/rate-limit";

const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";

export async function signup(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const fullName = String(formData.get("fullName"));

  const ip = await getClientIp();
  if (!(await checkRateLimit(`signup:${ip}`, 5, 3600))) {
    redirect(`/signup?error=${encodeURIComponent(TOO_MANY)}`);
  }

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

  // Dois limites: por IP (varredura de várias contas) e por e-mail
  // (força bruta numa conta só, mesmo vindo de muitos IPs).
  const ip = await getClientIp();
  const allowed =
    (await checkRateLimit(`login-ip:${ip}`, 20, 300)) &&
    (await checkRateLimit(`login-email:${hashKey(email)}`, 8, 900));
  if (!allowed) {
    redirect(`/login?error=${encodeURIComponent(TOO_MANY)}&email=${encodeURIComponent(email)}`);
  }

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

  // Evita usar o formulário para disparar e-mails em massa. Mesma resposta
  // genérica de sempre, para não revelar nada sobre a conta.
  const ip = await getClientIp();
  const allowed =
    (await checkRateLimit(`reset-ip:${ip}`, 10, 3600)) &&
    (await checkRateLimit(`reset-email:${hashKey(email)}`, 3, 3600));
  if (!allowed) {
    redirect("/esqueci-senha?sent=1");
  }

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
