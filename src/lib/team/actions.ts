"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { requireCapability } from "@/lib/permissions";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createPublicClient } from "@/lib/supabase/public";
import { siteUrl } from "@/lib/site-url";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_ROLES = ["profissional", "recepcao"];

async function requireAdmin() {
  const ctx = await getTenantContext();
  requireCapability(ctx.role, "team");
  return { ...ctx, supabase: await createClient() };
}

export async function createInvite(formData: FormData) {
  const { supabase, tenantId, userId } = await requireAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");

  if (!EMAIL_RE.test(email) || email.length > 160 || !INVITE_ROLES.includes(role)) {
    redirect(`/dashboard/equipe?error=${encodeURIComponent("Informe um e-mail válido e o papel.")}`);
  }

  const { error } = await supabase
    .from("team_invites")
    .insert({ tenant_id: tenantId, email, role, invited_by: userId });

  if (error) {
    const message =
      error.code === "23505"
        ? "Já existe um convite em aberto para esse e-mail."
        : error.message;
    redirect(`/dashboard/equipe?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/equipe");
  redirect(
    `/dashboard/equipe?success=${encodeURIComponent("Convite criado. Copie o link e envie para a pessoa.")}`,
  );
}

export async function revokeInvite(formData: FormData) {
  const { supabase, tenantId } = await requireAdmin();
  const id = String(formData.get("id") ?? "");

  await supabase
    .from("team_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("accepted_at", null);

  revalidatePath("/dashboard/equipe");
  redirect(`/dashboard/equipe?success=${encodeURIComponent("Convite cancelado.")}`);
}

export async function changeMemberRole(formData: FormData) {
  const { supabase } = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  const { error } = await supabase.rpc("set_member_role", { p_user_id: userId, p_role: role });
  if (error) {
    redirect(`/dashboard/equipe?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/equipe");
  redirect(`/dashboard/equipe?success=${encodeURIComponent("Papel atualizado.")}`);
}

export async function removeMember(formData: FormData) {
  const { supabase } = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");

  const { error } = await supabase.rpc("remove_member", { p_user_id: userId });
  if (error) {
    redirect(`/dashboard/equipe?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/equipe");
  redirect(`/dashboard/equipe?success=${encodeURIComponent("Membro removido da clínica.")}`);
}

// Cadastro de quem recebeu o convite: a conta nasce dentro da clínica
// (trigger handle_new_user, migration 0016), não numa clínica nova.
export async function signupWithInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const back = (msg: string) =>
    redirect(`/convite/${encodeURIComponent(token)}?error=${encodeURIComponent(msg)}`);

  const ip = await getClientIp();
  if (!(await checkRateLimit(`invite:${ip}`, 10, 3600))) {
    back("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
  }

  if (!fullName || fullName.length > 120 || password.length < 6) {
    back("Informe seu nome e uma senha com pelo menos 6 caracteres.");
  }

  // O e-mail vem do convite (não do formulário): só quem foi convidado
  // com aquele endereço consegue entrar.
  const { data } = await createPublicClient().rpc("get_invite_info", { p_token: token });
  const invite = (data as { email: string }[] | null)?.[0];
  if (!invite) {
    back("Convite inválido ou expirado. Peça um novo ao administrador.");
  }

  const supabase = await createClient();
  const { data: signed, error } = await supabase.auth.signUp({
    email: invite!.email,
    password,
    options: {
      data: { full_name: fullName, invite_token: token },
      emailRedirectTo: `${await siteUrl()}/auth/confirm`,
    },
  });

  if (error) {
    back(
      /database error/i.test(error.message)
        ? "Convite inválido ou expirado. Peça um novo ao administrador."
        : error.message,
    );
  }

  if (!signed?.session) {
    redirect("/signup?checkEmail=1");
  }

  redirect("/dashboard");
}
