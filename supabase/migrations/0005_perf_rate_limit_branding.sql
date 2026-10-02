-- F1 — melhorias de performance, rate limiting e branding por clínica.

-- 1) Índice parcial para a query do webhook de resposta do paciente
-- (filtra por status='pending' + starts_at futuro, sem índice dedicado
-- até aqui — só existia (professional_id, starts_at) e o parcial de
-- lembrete para status='confirmed').
create index if not exists appointments_pending_starts_idx
  on public.appointments (starts_at)
  where status = 'pending';

-- 2) Rate limiting — tabela + função atômica de "token bucket" por
-- janela fixa. Usada nas rotas públicas (agendamento, consulta de
-- horários) que não exigem login e por isso não têm nenhum limite hoje.
create table if not exists public.rate_limits (
  key text primary key,
  count int not null default 1,
  window_start timestamptz not null default now()
);

-- RLS sem nenhuma política = nenhum acesso direto via REST (nem anon
-- nem authenticated). Só a função security definer abaixo lê/escreve
-- aqui — não há motivo pra expor contadores de rate limit via API.
alter table public.rate_limits enable row level security;

-- check_rate_limit: incrementa o contador da janela atual e devolve
-- false quando o limite já foi atingido. A janela reinicia sozinha
-- quando expira — não precisa de cron de limpeza para funcionar
-- (a tabela cresce 1 linha por chave única, ok para o volume esperado).
create or replace function public.check_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count int;
  v_window_start timestamptz;
begin
  insert into public.rate_limits (key, count, window_start)
  values (p_key, 1, v_now)
  on conflict (key) do update
    set count = case
          when public.rate_limits.window_start <= v_now - make_interval(secs => p_window_seconds)
            then 1
          else public.rate_limits.count + 1
        end,
        window_start = case
          when public.rate_limits.window_start <= v_now - make_interval(secs => p_window_seconds)
            then v_now
          else public.rate_limits.window_start
        end
  returning count, window_start into v_count, v_window_start;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public;
grant execute on function public.check_rate_limit(text, int, int) to anon, authenticated;

-- 3) Branding: logo da clínica, exibido na página pública de
-- agendamento e no dashboard.
alter table public.tenants add column if not exists logo_url text;

-- Redefine get_booking_info (0002) incluindo o logo — mesma assinatura,
-- só adiciona a coluna no retorno.
drop function if exists public.get_booking_info(text);

create function public.get_booking_info(p_tenant_slug text)
returns table (
  tenant_name text,
  tenant_logo_url text,
  professional_id uuid,
  professional_name text,
  service_type_id uuid,
  service_name text,
  duration_minutes int,
  price_cents int
)
language sql
security definer set search_path = public
stable
as $$
  select
    t.name,
    t.logo_url,
    p.id,
    p.full_name,
    s.id,
    s.name,
    s.duration_minutes,
    s.price_cents
  from public.tenants t
  join public.profiles p on p.tenant_id = t.id and p.role in ('admin', 'profissional')
  join public.service_types s on s.tenant_id = t.id and s.active
  where t.slug = p_tenant_slug;
$$;

revoke all on function public.get_booking_info(text) from public;
grant execute on function public.get_booking_info(text) to anon, authenticated;

-- Bucket público (leitura) pra logo — precisa ser público porque a
-- página de agendamento (/agendar/[slug]) é acessada sem login pelo
-- paciente. Escrita só é permitida dentro da própria pasta do tenant
-- (primeiro segmento do path = tenant_id), então uma clínica não
-- sobrescreve o logo de outra.
insert into storage.buckets (id, name, public)
values ('tenant-logos', 'tenant-logos', true)
on conflict (id) do nothing;

create policy "tenant_logos_public_read"
  on storage.objects for select
  using (bucket_id = 'tenant-logos');

create policy "tenant_logos_tenant_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = (
      select tenant_id::text from public.profiles where id = auth.uid()
    )
  );

create policy "tenant_logos_tenant_update"
  on storage.objects for update
  using (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = (
      select tenant_id::text from public.profiles where id = auth.uid()
    )
  );

create policy "tenant_logos_tenant_delete"
  on storage.objects for delete
  using (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = (
      select tenant_id::text from public.profiles where id = auth.uid()
    )
  );
