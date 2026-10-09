-- F3 (continuação) — acerto de sessões:
--  1) pacotes de sessão pagos antecipado (session_packages): a clínica
--     recebe por N sessões de uma vez e o sistema acompanha o saldo.
--  2) link de pagamento (payment_links): junta uma ou mais cobranças
--     pendentes do mesmo paciente numa única página pública com o
--     código Pix Copia e Cola da própria clínica — nenhum gateway,
--     nenhuma credencial de terceiro, só formata o que a clínica já
--     usa pra receber (mesma categoria de "gerar código de barras de
--     boleto": é formatação, o dinheiro nunca passa pelo MindManager).

alter table public.tenants
  add column if not exists pix_key text,
  add column if not exists pix_holder_name text,
  add column if not exists pix_city text;

create table if not exists public.session_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  service_type_id uuid references public.service_types (id) on delete set null,
  sessions_total int not null check (sessions_total > 0),
  sessions_used int not null default 0 check (sessions_used >= 0),
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint session_packages_used_within_total check (sessions_used <= sessions_total)
);

create index if not exists session_packages_tenant_id_idx on public.session_packages (tenant_id);
create index if not exists session_packages_patient_id_idx on public.session_packages (patient_id);

alter table public.session_packages enable row level security;

create policy "session_packages_tenant_all"
  on public.session_packages for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

alter table public.invoices
  add column if not exists package_id uuid references public.session_packages (id) on delete set null;

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete set null,
  invoice_ids uuid[] not null,
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists payment_links_tenant_id_idx on public.payment_links (tenant_id);

alter table public.payment_links enable row level security;

create policy "payment_links_tenant_all"
  on public.payment_links for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Única forma de leitura pública (sem sessão): expõe só o necessário
-- pra montar a tela de pagamento — nunca a lista de invoice_ids, nunca
-- dados do paciente. Mesmo padrão de get_booking_info.
create or replace function public.get_payment_link_info(p_link_id uuid)
returns table (
  amount_cents int,
  status text,
  tenant_name text,
  tenant_logo_url text,
  pix_key text,
  pix_holder_name text,
  pix_city text
)
language sql
security definer set search_path = public
stable
as $$
  select
    pl.amount_cents,
    pl.status,
    t.name,
    t.logo_url,
    t.pix_key,
    t.pix_holder_name,
    t.pix_city
  from public.payment_links pl
  join public.tenants t on t.id = pl.tenant_id
  where pl.id = p_link_id;
$$;

revoke all on function public.get_payment_link_info(uuid) from public;
grant execute on function public.get_payment_link_info(uuid) to anon, authenticated;
