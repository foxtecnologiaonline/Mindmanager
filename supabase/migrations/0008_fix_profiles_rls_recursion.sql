-- BUG CRÍTICO: a policy "profiles_select_same_tenant" (migration 0001)
-- faz uma subquery em public.profiles dentro de uma policy que protege
-- a própria public.profiles — sob certos planos de consulta o Postgres
-- detecta isso como recursão infinita e recusa a query inteira com
-- "infinite recursion detected in policy for relation profiles".
--
-- Foi exatamente isso que quebrava o dashboard logo depois do
-- cadastro/login: a primeira leitura do profile (pra um usuário recém
-- criado, já com tenant_id setado pelo trigger) falhava com esse erro;
-- o código tratava erro como "tenant_id ausente" e caía no fallback
-- ensureTenantId, que por sua vez tentava recriar o tenant e colidia
-- com o que o trigger já tinha criado — só não dava pra ver isso até
-- aqui porque o Next, em produção, esconde a mensagem real do erro
-- (React error #441 / digest).
--
-- Fix: lookup do tenant_id do usuário atual via função security
-- definer (bypassa RLS internamente, sem reentrar na policy) em vez de
-- uma subquery direta na tabela protegida.

create or replace function public.current_tenant_id()
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to authenticated;

drop policy if exists "profiles_select_same_tenant" on public.profiles;

create policy "profiles_select_same_tenant"
  on public.profiles for select
  using (
    tenant_id is not null
    and tenant_id = public.current_tenant_id()
  );
