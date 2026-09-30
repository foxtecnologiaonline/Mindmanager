-- F0: fundação multi-tenant (tenant, profile, RLS)

create extension if not exists "pgcrypto";

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  billing_status text not null default 'trial'
    check (billing_status in ('trial', 'active', 'past_due', 'canceled')),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid references public.tenants (id) on delete cascade,
  full_name text not null,
  role text not null default 'admin'
    check (role in ('admin', 'profissional', 'recepcao')),
  created_at timestamptz not null default now()
);

create index if not exists profiles_tenant_id_idx on public.profiles (tenant_id);

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;

-- profiles: cada usuário só enxerga/edita seu próprio registro.
-- Não há policy de INSERT: a criação é feita exclusivamente pelo trigger
-- handle_new_user (security definer) no signup.
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid());

-- tenant_id só pode ser alterado pela função create_tenant_for_current_user
-- (security definer). Sem isso, qualquer usuário autenticado poderia trocar
-- seu próprio tenant_id via update direto e "entrar" em outra clínica.
revoke update (tenant_id) on public.profiles from authenticated;

-- profiles: colegas do mesmo tenant também podem ser vistos (agenda, equipe)
create policy "profiles_select_same_tenant"
  on public.profiles for select
  using (
    tenant_id is not null
    and tenant_id in (
      select p.tenant_id from public.profiles p where p.id = auth.uid()
    )
  );

-- tenants: visível apenas para quem pertence a ele
create policy "tenants_select_member"
  on public.tenants for select
  using (
    id in (select p.tenant_id from public.profiles p where p.id = auth.uid())
  );

-- Sem policy de INSERT em tenants: a criação é feita exclusivamente pela
-- função create_tenant_for_current_user abaixo (security definer), que
-- garante atomicidade entre "criar tenant" e "vincular profile" e evita
-- o problema de RETURNING ser filtrado pela própria policy de SELECT
-- (no momento do insert, o profile ainda não pertence ao tenant novo).
create or replace function public.create_tenant_for_current_user(
  tenant_name text,
  tenant_slug text
)
returns public.tenants
language plpgsql
security definer set search_path = public
as $$
declare
  new_tenant public.tenants;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if exists (
    select 1 from public.profiles
    where id = auth.uid() and tenant_id is not null
  ) then
    raise exception 'Este usuário já pertence a uma clínica.';
  end if;

  insert into public.tenants (name, slug)
  values (tenant_name, tenant_slug)
  returning * into new_tenant;

  update public.profiles set tenant_id = new_tenant.id where id = auth.uid();

  return new_tenant;
end;
$$;

revoke all on function public.create_tenant_for_current_user(text, text) from public;
grant execute on function public.create_tenant_for_current_user(text, text) to authenticated;

-- helper: cria o profile automaticamente no signup (sem tenant ainda)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'admin');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
