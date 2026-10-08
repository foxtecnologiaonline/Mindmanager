-- Simplificação: hoje um tenant novo nasce sem nenhum tipo de consulta
-- e sem nenhum horário de trabalho — a clínica só aparece como "pronta"
-- (checklist "Primeiros passos" do dashboard, link público de agendamento
-- funcional) depois de preencher os dois formulários em
-- /dashboard/agenda/configuracoes. Passa a nascer com um padrão sensato
-- (editável/removível a qualquer momento), pra reduzir a configuração
-- mínima necessária a zero: "Consulta" de 50min e expediente seg-sex
-- 09:00-18:00 pro admin que criou a conta.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_full_name text := coalesce(new.raw_user_meta_data ->> 'full_name', '');
  v_slug text;
  v_tenant_id uuid;
begin
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

  insert into public.service_types (tenant_id, name, duration_minutes)
  values (new_tenant.id, 'Consulta', 50);

  insert into public.working_hours (professional_id, day_of_week, start_time, end_time)
  select auth.uid(), dow, time '09:00', time '18:00'
  from unnest(array[1, 2, 3, 4, 5]) as dow;

  return new_tenant;
end;
$$;

-- Backfill: tenants que já existem hoje sem nenhum tipo de consulta e
-- sem nenhum horário de trabalho (configuração zero) recebem o mesmo
-- padrão, pros admins que ainda não passaram por
-- /dashboard/agenda/configuracoes. Tenant que já tem qualquer linha num
-- dos dois não é tocado — não sobrescreve configuração já feita.
do $$
declare
  v_tenant record;
begin
  for v_tenant in
    select t.id as tenant_id, p.id as admin_id
    from public.tenants t
    join public.profiles p on p.tenant_id = t.id and p.role = 'admin'
    where not exists (select 1 from public.service_types s where s.tenant_id = t.id)
      and not exists (
        select 1 from public.working_hours w
        join public.profiles p2 on p2.id = w.professional_id
        where p2.tenant_id = t.id
      )
  loop
    insert into public.service_types (tenant_id, name, duration_minutes)
    values (v_tenant.tenant_id, 'Consulta', 50);

    insert into public.working_hours (professional_id, day_of_week, start_time, end_time)
    select v_tenant.admin_id, dow, time '09:00', time '18:00'
    from unnest(array[1, 2, 3, 4, 5]) as dow;
  end loop;
end $$;
