-- F1: agenda (tipos de consulta, horários de trabalho, agendamentos)

create extension if not exists "btree_gist";

create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  duration_minutes int not null check (duration_minutes > 0),
  price_cents int check (price_cents is null or price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists service_types_tenant_id_idx on public.service_types (tenant_id);

create table if not exists public.working_hours (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = domingo
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint working_hours_valid_range check (end_time > start_time)
);

create index if not exists working_hours_professional_id_idx
  on public.working_hours (professional_id);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  professional_id uuid not null references public.profiles (id) on delete cascade,
  service_type_id uuid not null references public.service_types (id) on delete restrict,
  patient_name text not null,
  patient_phone text not null,
  patient_email text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  notes text,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint appointments_valid_range check (ends_at > starts_at)
);

create index if not exists appointments_tenant_id_idx on public.appointments (tenant_id);
create index if not exists appointments_professional_starts_idx
  on public.appointments (professional_id, starts_at);
create index if not exists appointments_reminder_pending_idx
  on public.appointments (starts_at)
  where status = 'confirmed' and reminder_sent_at is null;

-- Defesa em profundidade contra overlap: mesmo que a checagem na função
-- de reserva falhe sob concorrência, o banco recusa dois agendamentos
-- que se sobrepõem para o mesmo profissional.
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled');

alter table public.service_types enable row level security;
alter table public.working_hours enable row level security;
alter table public.appointments enable row level security;

-- Nenhuma dessas tabelas é lida/escrita diretamente por anon: o acesso
-- público de agendamento passa exclusivamente pelas funções security
-- definer abaixo, que expõem só o necessário (sem vazar dados de outros
-- pacientes ou de outras clínicas).

create policy "service_types_tenant_all"
  on public.service_types for all
  using (tenant_id in (select tenant_id from public.profiles where id = auth.uid()))
  with check (tenant_id in (select tenant_id from public.profiles where id = auth.uid()));

create policy "working_hours_tenant_all"
  on public.working_hours for all
  using (
    professional_id in (
      select p.id from public.profiles p
      where p.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
    )
  )
  with check (
    professional_id in (
      select p.id from public.profiles p
      where p.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
    )
  );

create policy "appointments_tenant_all"
  on public.appointments for all
  using (tenant_id in (select tenant_id from public.profiles where id = auth.uid()))
  with check (tenant_id in (select tenant_id from public.profiles where id = auth.uid()));

-- get_booking_info: dados públicos necessários para montar a tela de
-- agendamento (nome da clínica, profissionais, tipos de consulta ativos).
create or replace function public.get_booking_info(p_tenant_slug text)
returns table (
  tenant_name text,
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

-- get_available_slots: calcula horários livres a partir dos working_hours
-- menos agendamentos existentes. Não expõe nenhuma linha de appointments
-- diretamente — só os horários computados.
-- Simplificação MVP: timezone fixo America/Sao_Paulo (produto Brasil-only).
create or replace function public.get_available_slots(
  p_professional_id uuid,
  p_service_type_id uuid,
  p_day date
)
returns setof timestamptz
language plpgsql
security definer set search_path = public
stable
as $$
declare
  v_duration int;
  v_dow smallint;
  v_slot timestamptz;
  v_window record;
  v_window_end timestamptz;
begin
  select duration_minutes into v_duration
  from public.service_types
  where id = p_service_type_id and active;

  if v_duration is null then
    return;
  end if;

  v_dow := extract(dow from p_day);

  for v_window in
    select start_time, end_time from public.working_hours
    where professional_id = p_professional_id and day_of_week = v_dow
  loop
    v_slot := (p_day::timestamp + v_window.start_time) at time zone 'America/Sao_Paulo';
    v_window_end := (p_day::timestamp + v_window.end_time) at time zone 'America/Sao_Paulo';

    while v_slot + make_interval(mins => v_duration) <= v_window_end loop
      if v_slot > now() and not exists (
        select 1 from public.appointments a
        where a.professional_id = p_professional_id
          and a.status <> 'cancelled'
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(v_slot, v_slot + make_interval(mins => v_duration))
      ) then
        return next v_slot;
      end if;
      v_slot := v_slot + make_interval(mins => v_duration);
    end loop;
  end loop;

  return;
end;
$$;

revoke all on function public.get_available_slots(uuid, uuid, date) from public;
grant execute on function public.get_available_slots(uuid, uuid, date) to anon, authenticated;

-- book_appointment: única forma de criar um agendamento a partir do link
-- público. Revalida tudo no servidor (profissional pertence ao tenant,
-- serviço ativo, horário no futuro, sem overlap) antes de inserir.
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

revoke all on function public.book_appointment(text, uuid, uuid, text, text, text, timestamptz) from public;
grant execute on function public.book_appointment(text, uuid, uuid, text, text, text, timestamptz)
  to anon, authenticated;
