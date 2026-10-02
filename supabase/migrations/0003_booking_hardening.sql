-- F1 hardening: book_appointment não validava que o horário cai dentro do
-- working_hours do profissional — só checava overlap com outros
-- agendamentos. Na prática o link público sempre oferece apenas horários
-- já filtrados por get_available_slots, mas a função RPC em si aceitava
-- qualquer timestamptz futuro sem overlap, inclusive fora do expediente,
-- se chamada diretamente (outra integração, bug de client, etc).
--
-- Mantém flexibilidade para a equipe (usuário autenticado) forçar um
-- horário fora do expediente cadastrado quando necessário; bloqueia isso
-- apenas para o caminho público/anônimo, que é o único sem supervisão
-- humana no momento da marcação.
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

  insert into public.appointments (
    tenant_id, professional_id, service_type_id,
    patient_name, patient_phone, patient_email,
    starts_at, ends_at
  ) values (
    v_tenant_id, p_professional_id, p_service_type_id,
    p_patient_name, p_patient_phone, nullif(trim(coalesce(p_patient_email, '')), ''),
    p_starts_at, v_ends_at
  )
  returning * into v_appointment;

  return v_appointment;
end;
$$;
