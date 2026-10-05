-- F1 — clínica escolhe entre o número compartilhado da plataforma ou
-- conectar o próprio número de WhatsApp (via ZapScript, API pública v1).

-- BUG: tenants nunca teve policy de UPDATE. Qualquer update direto pelo
-- client autenticado (ex: uploadTenantLogo, migration 0005) era negado
-- silenciosamente pelo RLS — afeta 0 linhas, sem erro visível. Corrige
-- isso e já cobre as novas colunas de WhatsApp abaixo.
create policy "tenants_update_admin"
  on public.tenants for update
  using (
    id in (
      select p.tenant_id from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    id in (
      select p.tenant_id from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

alter table public.tenants
  add column if not exists whatsapp_mode text not null default 'shared'
    check (whatsapp_mode in ('shared', 'own')),
  add column if not exists whatsapp_api_key text,
  add column if not exists whatsapp_number_id text,
  add column if not exists whatsapp_webhook_secret text;

-- A API key e o secret do webhook nunca devem voltar pro client via
-- select (nem pro próprio admin que configurou — a UI nunca precisa
-- reexibi-los). Toda leitura desses dois campos passa pela service
-- role (server actions/webhooks), que ignora esse revoke.
revoke select (whatsapp_api_key, whatsapp_webhook_secret)
  on public.tenants from authenticated;
