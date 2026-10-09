-- Endurecimento de segurança (auditoria 2026-10-09).
--
-- 1) REVOKE de coluna não funciona quando o role já tem GRANT na tabela
--    inteira (padrão do Supabase para authenticated/anon). Os revokes de
--    0001 (profiles.tenant_id) e 0006 (tenants.whatsapp_*) eram, na
--    prática, sem efeito: um usuário logado podia PATCH-ar o próprio
--    profile.tenant_id/role (entrando em outra clínica como admin) e ler
--    a chave de API e o segredo de webhook do WhatsApp da própria clínica.
--    Aqui: revoga na TABELA e concede só as colunas que o app realmente
--    usa via client logado.
-- 2) book_appointment: bypass de expediente só para a equipe do PRÓPRIO
--    tenant (antes bastava estar logado em qualquer clínica), limites de
--    tamanho/horizonte, telefone mínimo válido, erro amigável em overlap.
-- 3) Triggers garantindo que as FKs (paciente/profissional/serviço/...)
--    pertencem ao mesmo tenant do registro — a RLS só olhava tenant_id.
-- 4) Cancelar consulta cancela a cobrança pendente dela (e desfazer o
--    cancelamento restaura), pra não inflar "a receber".

-- ---------------------------------------------------------------- 1) grants
revoke insert, update, delete on public.profiles from authenticated, anon;
-- Nenhuma tela edita profile pelo client (nome/role/tenant mudam só via
-- funções security definer). Se um dia houver "editar meu nome", conceder
-- apenas: grant update (full_name) on public.profiles to authenticated;
drop policy if exists "profiles_update_own" on public.profiles;

revoke insert, update, delete on public.tenants from authenticated, anon;
grant update (
  logo_url, pix_key, pix_holder_name, pix_city,
  whatsapp_mode, whatsapp_api_key, whatsapp_number_id, whatsapp_webhook_secret
) on public.tenants to authenticated;

revoke select on public.tenants from authenticated, anon;
grant select (
  id, name, slug, billing_status, trial_ends_at, created_at, logo_url,
  pix_key, pix_holder_name, pix_city, whatsapp_mode, whatsapp_number_id
) on public.tenants to authenticated;
-- whatsapp_api_key e whatsapp_webhook_secret: só a service role lê.

-- ------------------------------------------------- 3) FKs do mesmo tenant
create or replace function public.enforce_same_tenant_refs()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'appointments' then
    if not exists (select 1 from public.profiles where id = new.professional_id and tenant_id = new.tenant_id) then
      raise exception 'Profissional inválido para esta clínica.';
    end if;
    if not exists (select 1 from public.service_types where id = new.service_type_id and tenant_id = new.tenant_id) then
      raise exception 'Tipo de consulta inválido para esta clínica.';
    end if;
    if new.patient_id is not null
       and not exists (select 1 from public.patients where id = new.patient_id and tenant_id = new.tenant_id) then
      raise exception 'Paciente inválido para esta clínica.';
    end if;

  elsif tg_table_name = 'invoices' then
    if new.patient_id is not null
       and not exists (select 1 from public.patients where id = new.patient_id and tenant_id = new.tenant_id) then
      raise exception 'Paciente inválido para esta clínica.';
    end if;
    if new.appointment_id is not null
       and not exists (select 1 from public.appointments where id = new.appointment_id and tenant_id = new.tenant_id) then
      raise exception 'Consulta inválida para esta clínica.';
    end if;
    if new.package_id is not null
       and not exists (select 1 from public.session_packages where id = new.package_id and tenant_id = new.tenant_id) then
      raise exception 'Pacote inválido para esta clínica.';
    end if;

  elsif tg_table_name = 'session_packages' then
    if not exists (select 1 from public.patients where id = new.patient_id and tenant_id = new.tenant_id) then
      raise exception 'Paciente inválido para esta clínica.';
    end if;
    if new.service_type_id is not null
       and not exists (select 1 from public.service_types where id = new.service_type_id and tenant_id = new.tenant_id) then
      raise exception 'Tipo de consulta inválido para esta clínica.';
    end if;

  elsif tg_table_name = 'payment_links' then
    if new.patient_id is not null
       and not exists (select 1 from public.patients where id = new.patient_id and tenant_id = new.tenant_id) then
      raise exception 'Paciente inválido para esta clínica.';
    end if;
    if (select count(*) from public.invoices
         where id = any (new.invoice_ids) and tenant_id = new.tenant_id)
       <> coalesce(array_length(new.invoice_ids, 1), 0) then
      raise exception 'Cobrança inválida para esta clínica.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_same_tenant on public.appointments;
create trigger appointments_same_tenant
  before insert or update of professional_id, service_type_id, patient_id on public.appointments
  for each row execute function public.enforce_same_tenant_refs();

drop trigger if exists invoices_same_tenant on public.invoices;
create trigger invoices_same_tenant
  before insert or update of patient_id, appointment_id, package_id on public.invoices
  for each row execute function public.enforce_same_tenant_refs();

drop trigger if exists session_packages_same_tenant on public.session_packages;
create trigger session_packages_same_tenant
  before insert or update of patient_id, service_type_id on public.session_packages
  for each row execute function public.enforce_same_tenant_refs();

drop trigger if exists payment_links_same_tenant on public.payment_links;
create trigger payment_links_same_tenant
  before insert or update of patient_id, invoice_ids on public.payment_links
  for each row execute function public.enforce_same_tenant_refs();

-- ----------------------------------- 4) cancelar consulta ↔ cobrança
create or replace function public.sync_invoices_on_appointment_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.invoices set status = 'cancelled'
    where appointment_id = new.id and status = 'pending';
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    -- Desfazer cancelamento: reabre só a cobrança cancelada mais recente,
    -- e só se a consulta não tiver outra cobrança ativa/paga.
    update public.invoices set status = 'pending'
    where id = (
      select id from public.invoices
      where appointment_id = new.id and status = 'cancelled'
      order by created_at desc limit 1
    )
    and not exists (
      select 1 from public.invoices i2
      where i2.appointment_id = new.id and i2.status <> 'cancelled'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_sync_invoices on public.appointments;
create trigger appointments_sync_invoices
  after update of status on public.appointments
  for each row execute function public.sync_invoices_on_appointment_status();

-- ------------------------------------------------- 2) book_appointment
create or replace function public.book_appointment(
  p_tenant_slug text,
  p_professional_id uuid,
  p_service_type_id uuid,
  p_patient_name text,
  p_patient_phone text,
  p_patient_email text,
  p_starts_at timestamptz
)
returns public.appointments
language plpgsql
security definer set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_duration int;
  v_price_cents int;
  v_ends_at timestamptz;
  v_appointment public.appointments;
  v_dow smallint;
  v_local_start time;
  v_local_end time;
  v_patient_id uuid;
  v_phone_digits text;
  v_is_staff boolean;
begin
  select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
  if v_tenant_id is null then
    raise exception 'Clínica não encontrada.';
  end if;

  if trim(coalesce(p_patient_name, '')) = '' then
    raise exception 'Informe o nome do paciente.';
  end if;
  if length(p_patient_name) > 120 then
    raise exception 'Nome muito longo.';
  end if;

  v_phone_digits := regexp_replace(coalesce(p_patient_phone, ''), '\D', '', 'g');
  if length(v_phone_digits) < 10 or length(v_phone_digits) > 13 or length(p_patient_phone) > 30 then
    raise exception 'Telefone inválido. Informe DDD + número.';
  end if;

  if length(coalesce(p_patient_email, '')) > 160 then
    raise exception 'E-mail muito longo.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_professional_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Profissional inválido.';
  end if;

  select duration_minutes, price_cents into v_duration, v_price_cents
  from public.service_types
  where id = p_service_type_id and tenant_id = v_tenant_id and active;

  if v_duration is null then
    raise exception 'Tipo de consulta inválido.';
  end if;

  if p_starts_at <= now() then
    raise exception 'Não é possível agendar em um horário no passado.';
  end if;
  if p_starts_at > now() + interval '1 year' then
    raise exception 'Data muito distante.';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  -- Só a equipe DESTA clínica pode forçar horário fora do expediente;
  -- anônimo ou usuário logado de outra clínica fica preso ao working_hours.
  v_is_staff := auth.uid() is not null and exists (
    select 1 from public.profiles
    where id = auth.uid() and tenant_id = v_tenant_id
  );

  if not v_is_staff then
    v_dow := extract(dow from (p_starts_at at time zone 'America/Sao_Paulo'));
    v_local_start := (p_starts_at at time zone 'America/Sao_Paulo')::time;
    v_local_end := (v_ends_at at time zone 'America/Sao_Paulo')::time;

    if not exists (
      select 1 from public.working_hours
      where professional_id = p_professional_id
        and day_of_week = v_dow
        and start_time <= v_local_start
        and end_time >= v_local_end
    ) then
      raise exception 'Esse horário está fora do expediente do profissional.';
    end if;
  end if;

  if exists (
    select 1 from public.appointments
    where professional_id = p_professional_id
      and status <> 'cancelled'
      and tstzrange(starts_at, ends_at) && tstzrange(p_starts_at, v_ends_at)
  ) then
    raise exception 'Esse horário acabou de ser preenchido. Escolha outro.';
  end if;

  select id into v_patient_id
  from public.patients
  where tenant_id = v_tenant_id
    and deleted_at is null
    and right(regexp_replace(phone, '\D', '', 'g'), 9) = right(v_phone_digits, 9)
  limit 1;

  if v_patient_id is null then
    insert into public.patients (tenant_id, full_name, phone, email)
    values (
      v_tenant_id,
      p_patient_name,
      p_patient_phone,
      nullif(trim(coalesce(p_patient_email, '')), '')
    )
    returning id into v_patient_id;
  end if;

  begin
    insert into public.appointments (
      tenant_id, professional_id, service_type_id, patient_id,
      patient_name, patient_phone, patient_email,
      starts_at, ends_at
    ) values (
      v_tenant_id, p_professional_id, p_service_type_id, v_patient_id,
      p_patient_name, p_patient_phone, nullif(trim(coalesce(p_patient_email, '')), ''),
      p_starts_at, v_ends_at
    )
    returning * into v_appointment;
  exception when exclusion_violation then
    -- Corrida entre o exists acima e o insert: o constraint do banco
    -- venceu — devolve a mesma mensagem amigável, não o erro cru.
    raise exception 'Esse horário acabou de ser preenchido. Escolha outro.';
  end;

  if v_price_cents is not null and v_price_cents > 0 then
    insert into public.invoices (tenant_id, patient_id, appointment_id, amount_cents)
    values (v_tenant_id, v_patient_id, v_appointment.id, v_price_cents);
  end if;

  return v_appointment;
end;
$$;
