-- Liga agendamento e cadastro de paciente: toda consulta (manual ou pelo
-- link público) passa a resolver um public.patients por telefone —
-- acha e usa o cadastro existente, ou cria um novo na hora se o
-- telefone não bate com nenhum paciente já cadastrado no tenant. Não
-- muda o paciente já cadastrado (nome/e-mail somente na criação): uma
-- consulta nova com dados levemente diferentes não sobrescreve o
-- cadastro.
--
-- Casamento por telefone normalizado (últimos 9 dígitos, mesma regra
-- já usada no webhook do WhatsApp em zapscript-webhook.ts) em vez de
-- igualdade exata de string — o telefone pode estar formatado
-- diferente entre o cadastro e o formulário de agendamento.
--
-- patient_name/patient_phone/patient_email continuam existindo em
-- appointments como snapshot histórico da consulta (não removidos):
-- é o que a grade, o webhook de confirmação e os relatórios já leem
-- direto, sem precisar de join. patient_id é a ligação nova, nullable
-- (on delete set null — apagar um paciente não derruba o histórico de
-- consultas, só desvincula).

alter table public.appointments
  add column if not exists patient_id uuid references public.patients (id) on delete set null;

create index if not exists appointments_patient_id_idx on public.appointments (patient_id);

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
  v_ends_at timestamptz;
  v_appointment public.appointments;
  v_dow smallint;
  v_local_start time;
  v_local_end time;
  v_patient_id uuid;
begin
  select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
  if v_tenant_id is null then
    raise exception 'Clínica não encontrada.';
  end if;

  if trim(coalesce(p_patient_name, '')) = '' then
    raise exception 'Informe o nome do paciente.';
  end if;

  if trim(coalesce(p_patient_phone, '')) = '' then
    raise exception 'Informe um telefone de contato.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_professional_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Profissional inválido.';
  end if;

  select duration_minutes into v_duration
  from public.service_types
  where id = p_service_type_id and tenant_id = v_tenant_id and active;

  if v_duration is null then
    raise exception 'Tipo de consulta inválido.';
  end if;

  if p_starts_at <= now() then
    raise exception 'Não é possível agendar em um horário no passado.';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  -- Defesa em profundidade: caller anônimo (link público) só pode marcar
  -- dentro de um working_hours cadastrado para aquele profissional+dia.
  -- Usuário autenticado (equipe) pode forçar fora do expediente.
  if auth.uid() is null then
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
    and right(regexp_replace(phone, '\D', '', 'g'), 9) = right(regexp_replace(p_patient_phone, '\D', '', 'g'), 9)
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

  return v_appointment;
end;
$$;
