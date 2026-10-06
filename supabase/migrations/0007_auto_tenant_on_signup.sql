-- F0 — remove a pergunta "nome da clínica" do onboarding: o tenant
-- nasce automaticamente junto com o profile, no mesmo trigger de
-- signup, com um nome padrão (editável depois, quando essa UI existir).
-- O usuário vai direto pro dashboard e começa cadastrando pacientes e
-- preenchendo a agenda — sem passo extra no meio.

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

  return new;
end;
$$;

-- Backfill: contas criadas antes desta migration (trigger antigo só
-- criava o profile, sem tenant) ficaram paradas no onboarding — o
-- fallback em /onboarding também cobre isso sem precisar desta query,
-- mas corrigir aqui evita a espera de um login extra.
do $$
declare
  v_profile record;
  v_slug text;
  v_tenant_id uuid;
begin
  for v_profile in
    select id, full_name from public.profiles where tenant_id is null
  loop
    v_slug := lower(regexp_replace(coalesce(nullif(v_profile.full_name, ''), 'clinica'), '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' then
      v_slug := 'clinica';
    end if;
    v_slug := v_slug || '-' || substr(v_profile.id::text, 1, 6);

    insert into public.tenants (name, slug)
    values (coalesce(nullif(v_profile.full_name, ''), 'Minha Clínica'), v_slug)
    returning id into v_tenant_id;

    update public.profiles set tenant_id = v_tenant_id where id = v_profile.id;
  end loop;
end $$;
