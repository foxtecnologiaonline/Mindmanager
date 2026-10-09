-- F3 (início) — módulo financeiro: contas a receber + recibo.
--
-- Escopo desta migration: registrar o que cada consulta custa e cobrar
-- o controle de pago/pendente — a clínica continua recebendo pelo seu
-- próprio PIX/maquininha, o sistema só acompanha e emite recibo. Captura
-- automática de pagamento (gerar cobrança PIX, processar cartão) é um
-- passo separado que depende de escolher um provedor (Mercado Pago,
-- Asaas, Stripe etc.) — decisão de negócio, não só técnica, então fica
-- de fora por agora.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  amount_cents int not null check (amount_cents > 0),
  method text check (method in ('pix', 'card', 'cash', 'other')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists invoices_tenant_id_idx on public.invoices (tenant_id);
create index if not exists invoices_patient_id_idx on public.invoices (patient_id);
create index if not exists invoices_status_idx on public.invoices (tenant_id, status);

alter table public.invoices enable row level security;

create policy "invoices_tenant_all"
  on public.invoices for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Gera a conta a receber na hora de agendar, sem passo extra pra
-- equipe: só quando o tipo de consulta tem preço cadastrado (service_types
-- .price_cents) — serviço sem preço simplesmente não gera cobrança.
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

  select duration_minutes, price_cents into v_duration, v_price_cents
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
    and deleted_at is null
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

  if v_price_cents is not null and v_price_cents > 0 then
    insert into public.invoices (tenant_id, patient_id, appointment_id, amount_cents)
    values (v_tenant_id, v_patient_id, v_appointment.id, v_price_cents);
  end if;

  return v_appointment;
end;
$$;
