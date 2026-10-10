-- Equipe e papéis.
--
-- 1) Convite de equipe: o admin gera um link com token secreto; quem abre
--    o link cria a conta JÁ dentro da clínica (profissional ou recepção) em
--    vez de nascer com uma clínica própria. O token só vale uma vez, expira
--    em 7 dias e exige o mesmo e-mail do convite.
-- 2) Papéis aplicados no banco (RLS), não só escondidos na interface:
--      admin      → tudo
--      profissional → agenda, pacientes, prontuário
--      recepcao   → agenda, pacientes, financeiro (sem prontuário)
--    Configuração (tipos de consulta, expediente de terceiros) é do admin.
-- 3) Gestão de membros (trocar papel / remover) por funções security
--    definer, com a regra de nunca deixar a clínica sem admin.

-- --------------------------------------------------------------- helpers
create or replace function public.current_user_role()
returns text
language sql
security definer set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- --------------------------------------------------------------- convites
create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (length(email) between 3 and 160),
  role text not null check (role in ('profissional', 'recepcao')),
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz
);

create index if not exists team_invites_tenant_id_idx on public.team_invites (tenant_id);

-- Um convite em aberto por e-mail/clínica.
create unique index if not exists team_invites_open_email_idx
  on public.team_invites (tenant_id, lower(email))
  where accepted_at is null and revoked_at is null;

alter table public.team_invites enable row level security;

create policy "team_invites_admin_all"
  on public.team_invites for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- Tela pública do convite: devolve só o necessário e só se o convite for
-- válido. O token (64 hex) é o segredo — quem o tem já recebeu o link.
create or replace function public.get_invite_info(p_token text)
returns table (tenant_name text, role text, email text)
language sql
security definer set search_path = public
stable
as $$
  select t.name, i.role, i.email
  from public.team_invites i
  join public.tenants t on t.id = i.tenant_id
  where i.token = p_token
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now();
$$;

revoke all on function public.get_invite_info(text) from public;
grant execute on function public.get_invite_info(text) to anon, authenticated;

-- ------------------------------------------------- signup (com ou sem convite)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_full_name text := coalesce(new.raw_user_meta_data ->> 'full_name', '');
  v_token text := nullif(new.raw_user_meta_data ->> 'invite_token', '');
  v_invite public.team_invites;
  v_slug text;
  v_tenant_id uuid;
begin
  if v_token is not null then
    select * into v_invite
    from public.team_invites
    where token = v_token
      and accepted_at is null
      and revoked_at is null
      and expires_at > now()
    for update;

    if not found or lower(v_invite.email) <> lower(coalesce(new.email, '')) then
      raise exception 'Convite inválido, expirado ou para outro e-mail.';
    end if;

    insert into public.profiles (id, tenant_id, full_name, role)
    values (new.id, v_invite.tenant_id, v_full_name, v_invite.role);

    update public.team_invites
    set accepted_at = now(), accepted_by = new.id
    where id = v_invite.id;

    -- Profissional já nasce atendendo seg-sex 09-18 (editável), igual ao admin.
    if v_invite.role = 'profissional' then
      insert into public.working_hours (professional_id, day_of_week, start_time, end_time)
      select new.id, dow, time '09:00', time '18:00'
      from unnest(array[1, 2, 3, 4, 5]) as dow;
    end if;

    return new;
  end if;

  v_slug := lower(regexp_replace(coalesce(nullif(v_full_name, ''), 'clinica'), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then
    v_slug := 'clinica';
  end if;
  v_slug := v_slug || '-' || substr(new.id::text, 1, 6);

  insert into public.tenants (name, slug)
  values (coalesce(nullif(v_full_name, ''), 'Minha Clínica'), v_slug)
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, full_name, role)
  values (new.id, v_tenant_id, v_full_name, 'admin');

  insert into public.service_types (tenant_id, name, duration_minutes)
  values (v_tenant_id, 'Consulta', 50);

  insert into public.working_hours (professional_id, day_of_week, start_time, end_time)
  select new.id, dow, time '09:00', time '18:00'
  from unnest(array[1, 2, 3, 4, 5]) as dow;

  return new;
end;
$$;

-- ------------------------------------------------------ gestão de membros
create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_target public.profiles;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Apenas o administrador pode alterar papéis.';
  end if;
  if p_role not in ('admin', 'profissional', 'recepcao') then
    raise exception 'Papel inválido.';
  end if;

  select * into v_target from public.profiles
  where id = p_user_id and tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception 'Membro não encontrado nesta clínica.';
  end if;

  if v_target.role = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where tenant_id = v_tenant_id and role = 'admin') <= 1 then
    raise exception 'A clínica precisa de pelo menos um administrador.';
  end if;

  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_target public.profiles;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Apenas o administrador pode remover membros.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não pode remover a si mesmo.';
  end if;

  select * into v_target from public.profiles
  where id = p_user_id and tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception 'Membro não encontrado nesta clínica.';
  end if;

  if exists (
    select 1 from public.appointments
    where professional_id = p_user_id and status <> 'cancelled' and starts_at > now()
  ) then
    raise exception 'Esse profissional tem consultas futuras. Cancele ou reagende antes de remover.';
  end if;

  delete from public.working_hours where professional_id = p_user_id;

  -- Perfil continua existindo (histórico de consultas aponta para ele),
  -- mas sai da clínica; se voltar a entrar no app, ganha uma clínica própria
  -- e vazia, como qualquer conta nova.
  update public.profiles set tenant_id = null, role = 'admin' where id = p_user_id;
end;
$$;

revoke all on function public.set_member_role(uuid, text) from public;
revoke all on function public.remove_member(uuid) from public;
grant execute on function public.set_member_role(uuid, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;

-- ------------------------------------------------ papéis aplicados no RLS
-- Financeiro: admin e recepção. Profissional não vê cobranças.
do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'session_packages', 'payment_links'] loop
    execute format('drop policy if exists %I on public.%I', t || '_tenant_all', t);
    execute format(
      'create policy %I on public.%I for all
         using (tenant_id = public.current_tenant_id() and public.current_user_role() in (''admin'', ''recepcao''))
         with check (tenant_id = public.current_tenant_id() and public.current_user_role() in (''admin'', ''recepcao''))',
      t || '_finance_roles', t
    );
  end loop;
end $$;

-- Tipos de consulta: todos leem (agenda), só o admin altera.
drop policy if exists "service_types_tenant_all" on public.service_types;

create policy "service_types_select"
  on public.service_types for select
  using (tenant_id = public.current_tenant_id());

create policy "service_types_admin_write"
  on public.service_types for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- Expediente: todos leem; admin altera o de qualquer um, cada profissional
-- altera o próprio.
drop policy if exists "working_hours_tenant_all" on public.working_hours;

create policy "working_hours_select"
  on public.working_hours for select
  using (
    professional_id in (select p.id from public.profiles p where p.tenant_id = public.current_tenant_id())
  );

create policy "working_hours_write"
  on public.working_hours for all
  using (
    professional_id in (select p.id from public.profiles p where p.tenant_id = public.current_tenant_id())
    and (public.current_user_role() = 'admin' or professional_id = auth.uid())
  )
  with check (
    professional_id in (select p.id from public.profiles p where p.tenant_id = public.current_tenant_id())
    and (public.current_user_role() = 'admin' or professional_id = auth.uid())
  );
