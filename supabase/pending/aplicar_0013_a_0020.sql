-- MindManager: migrations 0013 a 0020 num arquivo só.
-- Pode ser colado inteiro no SQL Editor do Supabase (é re-executável).

-- ===================================================================
-- 0013_billing_invoices.sql
-- ===================================================================
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

drop policy if exists "invoices_tenant_all" on public.invoices;
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

-- ===================================================================
-- 0014_packages_and_payment_links.sql
-- ===================================================================
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

drop policy if exists "session_packages_tenant_all" on public.session_packages;
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

drop policy if exists "payment_links_tenant_all" on public.payment_links;
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

-- ===================================================================
-- 0015_security_hardening.sql
-- ===================================================================
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

-- ===================================================================
-- 0016_team_and_roles.sql
-- ===================================================================
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

drop policy if exists "team_invites_admin_all" on public.team_invites;
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
    execute format('drop policy if exists %I on public.%I', t || '_finance_roles', t);
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

drop policy if exists "service_types_select" on public.service_types;
create policy "service_types_select"
  on public.service_types for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists "service_types_admin_write" on public.service_types;
create policy "service_types_admin_write"
  on public.service_types for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- Expediente: todos leem; admin altera o de qualquer um, cada profissional
-- altera o próprio.
drop policy if exists "working_hours_tenant_all" on public.working_hours;

drop policy if exists "working_hours_select" on public.working_hours;
create policy "working_hours_select"
  on public.working_hours for select
  using (
    professional_id in (select p.id from public.profiles p where p.tenant_id = public.current_tenant_id())
  );

drop policy if exists "working_hours_write" on public.working_hours;
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

-- ===================================================================
-- 0017_clinical_records.sql
-- ===================================================================
-- Prontuário (evolução SOAP), anexos, trilha de auditoria e consentimento.
--
-- Requisitos do SCOPE: LGPD (dado de saúde = dado sensível), retenção de
-- 20 anos (CFM 1.821/2007), auditoria imutável (quem / quando / o quê).
--
-- O que o BANCO garante (independente do app):
--   * só admin e profissional acessam prontuário e anexos (recepção não);
--   * evolução assinada não pode ser alterada nem apagada — correção é
--     feita por adendo (nova evolução ligada à original);
--   * a trilha de auditoria só aceita inserção, nunca update/delete;
--   * anexos ficam num bucket privado, separados por clínica.
-- O que NÃO garante: a "assinatura" é um carimbo de integridade (SHA-256 do
-- conteúdo + autor + instante, gerado no servidor), NÃO uma assinatura
-- digital ICP-Brasil. Leituras são registradas pelo app (não dá pra
-- interceptar SELECT no banco).

-- ------------------------------------------------------------ consentimento
alter table public.patients
  add column if not exists consent_at timestamptz,
  add column if not exists consent_recorded_by uuid references public.profiles (id) on delete set null;

-- --------------------------------------------------------------- auditoria
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  patient_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at desc);
create index if not exists audit_log_patient_idx on public.audit_log (patient_id, created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_admin_select" on public.audit_log;
create policy "audit_log_admin_select"
  on public.audit_log for select
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- Nenhuma escrita direta: só via log_access() e triggers (security definer).
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A trilha de auditoria é imutável.';
end;
$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- Registro de LEITURA (e outras ações) feito pelo app.
create or replace function public.log_access(
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_patient_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant_id is null then
    raise exception 'Usuário não autenticado.';
  end if;
  if public.current_user_role() not in ('admin', 'profissional') then
    raise exception 'Sem permissão.';
  end if;
  if p_action not in ('record.view', 'attachment.download') then
    raise exception 'Ação de auditoria inválida.';
  end if;
  if p_patient_id is not null
     and not exists (select 1 from public.patients where id = p_patient_id and tenant_id = v_tenant_id) then
    raise exception 'Paciente inválido.';
  end if;

  -- Abrir/recarregar a mesma tela várias vezes não deve inflar a trilha:
  -- uma visualização por usuário/paciente a cada 5 minutos basta.
  if p_action = 'record.view' and exists (
    select 1 from public.audit_log
    where tenant_id = v_tenant_id and user_id = auth.uid() and action = p_action
      and patient_id is not distinct from p_patient_id
      and created_at > now() - interval '5 minutes'
  ) then
    return;
  end if;

  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, patient_id, metadata)
  values (v_tenant_id, auth.uid(), p_action, p_entity, p_entity_id, p_patient_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.log_access(text, text, uuid, uuid, jsonb) from public;
grant execute on function public.log_access(text, text, uuid, uuid, jsonb) to authenticated;

-- --------------------------------------------------------------- evoluções
create table if not exists public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  patient_id uuid not null references public.patients (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete set null,
  parent_id uuid references public.clinical_notes (id) on delete restrict,
  author_id uuid not null references public.profiles (id) on delete restrict,
  subjective text not null default '' check (length(subjective) <= 20000),
  objective text not null default '' check (length(objective) <= 20000),
  assessment text not null default '' check (length(assessment) <= 20000),
  plan text not null default '' check (length(plan) <= 20000),
  status text not null default 'draft' check (status in ('draft', 'signed')),
  signed_at timestamptz,
  signed_by uuid references public.profiles (id) on delete restrict,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_notes_signed_consistent check (
    (status = 'draft' and signed_at is null and content_hash is null)
    or (status = 'signed' and signed_at is not null and content_hash is not null and signed_by is not null)
  )
);

create index if not exists clinical_notes_patient_idx on public.clinical_notes (patient_id, created_at desc);
create index if not exists clinical_notes_tenant_idx on public.clinical_notes (tenant_id);

-- Carimbo de integridade: SHA-256 de todo o conteúdo + vínculos + instante.
create or replace function public.clinical_note_hash(n public.clinical_notes)
returns text
language sql
immutable
as $$
  select encode(
    sha256(convert_to(
      concat_ws('|',
        n.id::text, n.tenant_id::text, n.patient_id::text,
        coalesce(n.appointment_id::text, ''), coalesce(n.parent_id::text, ''),
        n.author_id::text, n.subjective, n.objective, n.assessment, n.plan,
        coalesce(to_char(n.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '')
      ),
      'UTF8'
    )),
    'hex'
  );
$$;

create or replace function public.clinical_notes_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.signed_at := null;
    new.signed_by := null;
    new.content_hash := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'signed' then
      raise exception 'Evolução assinada não pode ser apagada (retenção obrigatória).';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status = 'signed' then
    raise exception 'Evolução assinada é imutável. Registre um adendo.';
  end if;

  if new.tenant_id <> old.tenant_id or new.patient_id <> old.patient_id
     or new.author_id <> old.author_id or new.parent_id is distinct from old.parent_id
     or new.id <> old.id then
    raise exception 'Vínculos da evolução não podem ser alterados.';
  end if;

  if new.status = 'signed' then
    if auth.uid() is null or auth.uid() <> old.author_id then
      raise exception 'Só o autor pode assinar a evolução.';
    end if;
    if length(trim(new.subjective || new.objective || new.assessment || new.plan)) = 0 then
      raise exception 'Preencha ao menos um campo antes de assinar.';
    end if;
    new.signed_at := now();
    new.signed_by := auth.uid();
    new.content_hash := public.clinical_note_hash(new);
  else
    new.signed_at := null;
    new.signed_by := null;
    new.content_hash := null;
  end if;

  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clinical_notes_guard_trg on public.clinical_notes;
create trigger clinical_notes_guard_trg
  before insert or update or delete on public.clinical_notes
  for each row execute function public.clinical_notes_guard();

alter table public.clinical_notes enable row level security;

drop policy if exists "clinical_notes_select" on public.clinical_notes;
create policy "clinical_notes_select"
  on public.clinical_notes for select
  using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('admin', 'profissional'));

drop policy if exists "clinical_notes_insert" on public.clinical_notes;
create policy "clinical_notes_insert"
  on public.clinical_notes for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'profissional')
    and author_id = auth.uid()
  );

drop policy if exists "clinical_notes_update_own" on public.clinical_notes;
create policy "clinical_notes_update_own"
  on public.clinical_notes for update
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'profissional')
    and author_id = auth.uid()
  )
  with check (tenant_id = public.current_tenant_id() and author_id = auth.uid());

drop policy if exists "clinical_notes_delete_own_draft" on public.clinical_notes;
create policy "clinical_notes_delete_own_draft"
  on public.clinical_notes for delete
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'profissional')
    and author_id = auth.uid()
    and status = 'draft'
  );

-- Só o texto e o status podem ser enviados pelo client; o resto o trigger controla.
revoke update on public.clinical_notes from authenticated, anon;
grant update (subjective, objective, assessment, plan, status) on public.clinical_notes to authenticated;
revoke all on public.clinical_notes from anon;

-- Confere a integridade das evoluções assinadas de um paciente: o hash
-- gravado na assinatura precisa bater com o conteúdo atual. Roda com as
-- permissões de quem chama (RLS vale), então recepção não vê nada.
create or replace function public.verify_patient_notes(p_patient_id uuid)
returns table (note_id uuid, intact boolean)
language sql
security invoker
stable
as $$
  select n.id, n.content_hash = public.clinical_note_hash(n)
  from public.clinical_notes n
  where n.patient_id = p_patient_id and n.status = 'signed';
$$;

revoke all on function public.verify_patient_notes(uuid) from public;
grant execute on function public.verify_patient_notes(uuid) to authenticated;

-- ------------------------------------------------------------------ anexos
create table if not exists public.patient_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  patient_id uuid not null references public.patients (id) on delete restrict,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  file_name text not null check (length(file_name) between 1 and 200),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  description text check (description is null or length(description) <= 300),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists patient_attachments_patient_idx on public.patient_attachments (patient_id, created_at desc);

alter table public.patient_attachments enable row level security;

drop policy if exists "patient_attachments_select" on public.patient_attachments;
create policy "patient_attachments_select"
  on public.patient_attachments for select
  using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('admin', 'profissional'));

drop policy if exists "patient_attachments_insert" on public.patient_attachments;
create policy "patient_attachments_insert"
  on public.patient_attachments for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'profissional')
    and uploaded_by = auth.uid()
    and storage_path like tenant_id::text || '/' || patient_id::text || '/%'
  );

-- "Remover" = soft delete (o arquivo continua no storage por retenção).
drop policy if exists "patient_attachments_soft_delete" on public.patient_attachments;
create policy "patient_attachments_soft_delete"
  on public.patient_attachments for update
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'profissional')
    and (uploaded_by = auth.uid() or public.current_user_role() = 'admin')
  )
  with check (tenant_id = public.current_tenant_id());

revoke update, delete on public.patient_attachments from authenticated, anon;
grant update (deleted_at, description) on public.patient_attachments to authenticated;
revoke all on public.patient_attachments from anon;

-- Bucket PRIVADO. Pasta = <tenant_id>/<patient_id>/. Sem policy de
-- update/delete: ninguém sobrescreve nem apaga arquivo pelo client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-files', 'patient-files', false, 10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "patient_files_select" on storage.objects;
create policy "patient_files_select"
  on storage.objects for select
  using (
    bucket_id = 'patient-files'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_role() in ('admin', 'profissional')
  );

drop policy if exists "patient_files_insert" on storage.objects;
create policy "patient_files_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'patient-files'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_role() in ('admin', 'profissional')
  );

-- Consentimento registrado/alterado também entra na trilha.
create or replace function public.audit_patient_consent()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.consent_at is distinct from old.consent_at then
    insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, patient_id, metadata)
    values (new.tenant_id, auth.uid(), 'patient.consent', 'patient', new.id, new.id,
            jsonb_build_object('consent_at', new.consent_at));
  end if;
  return null;
end;
$$;

drop trigger if exists patients_consent_audit on public.patients;
create trigger patients_consent_audit
  after update of consent_at on public.patients
  for each row execute function public.audit_patient_consent();

-- ---------------------------------------------- auditoria automática (escrita)
create or replace function public.audit_clinical_writes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_action text;
  v_row record;
begin
  if tg_table_name = 'clinical_notes' then
    v_row := case when tg_op = 'DELETE' then old else new end;
    v_action := case
      when tg_op = 'INSERT' then 'note.create'
      when tg_op = 'DELETE' then 'note.delete_draft'
      when new.status = 'signed' then 'note.sign'
      else 'note.update'
    end;
    insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, patient_id, metadata)
    values (
      v_row.tenant_id, auth.uid(), v_action, 'clinical_note', v_row.id, v_row.patient_id,
      case when v_action = 'note.sign'
           then jsonb_build_object('content_hash', new.content_hash, 'parent_id', new.parent_id)
           else '{}'::jsonb end
    );
  else
    v_row := new;
    v_action := case
      when tg_op = 'INSERT' then 'attachment.upload'
      when new.deleted_at is not null and old.deleted_at is null then 'attachment.remove'
      else 'attachment.update'
    end;
    insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, patient_id, metadata)
    values (
      v_row.tenant_id, auth.uid(), v_action, 'patient_attachment', v_row.id, v_row.patient_id,
      jsonb_build_object('file_name', v_row.file_name)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists clinical_notes_audit on public.clinical_notes;
create trigger clinical_notes_audit
  after insert or update or delete on public.clinical_notes
  for each row execute function public.audit_clinical_writes();

drop trigger if exists patient_attachments_audit on public.patient_attachments;
create trigger patient_attachments_audit
  after insert or update on public.patient_attachments
  for each row execute function public.audit_clinical_writes();

-- ---------------------------------- vínculos do mesmo tenant (estende 0015)
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

  elsif tg_table_name = 'clinical_notes' then
    if not exists (select 1 from public.patients where id = new.patient_id and tenant_id = new.tenant_id) then
      raise exception 'Paciente inválido para esta clínica.';
    end if;
    if not exists (select 1 from public.profiles where id = new.author_id and tenant_id = new.tenant_id) then
      raise exception 'Autor inválido para esta clínica.';
    end if;
    if new.appointment_id is not null
       and not exists (select 1 from public.appointments where id = new.appointment_id and tenant_id = new.tenant_id) then
      raise exception 'Consulta inválida para esta clínica.';
    end if;
    if new.parent_id is not null
       and not exists (
         select 1 from public.clinical_notes
         where id = new.parent_id and tenant_id = new.tenant_id and patient_id = new.patient_id and status = 'signed'
       ) then
      raise exception 'Adendo só pode complementar uma evolução assinada do mesmo paciente.';
    end if;

  elsif tg_table_name = 'patient_attachments' then
    if not exists (select 1 from public.patients where id = new.patient_id and tenant_id = new.tenant_id) then
      raise exception 'Paciente inválido para esta clínica.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists clinical_notes_same_tenant on public.clinical_notes;
create trigger clinical_notes_same_tenant
  before insert on public.clinical_notes
  for each row execute function public.enforce_same_tenant_refs();

drop trigger if exists patient_attachments_same_tenant on public.patient_attachments;
create trigger patient_attachments_same_tenant
  before insert on public.patient_attachments
  for each row execute function public.enforce_same_tenant_refs();

-- ===================================================================
-- 0018_packages_nps_reminders.sql
-- ===================================================================
-- 1) Baixa automática de sessão de pacote ao concluir a consulta.
-- 2) Rastreio de qual cobrança foi paga por qual link de pagamento
--    (desfazer a confirmação do link só reabre o que ELE pagou).
-- 3) Pós-consulta + NPS: mensagem após a consulta concluída com link para
--    a nota (0-10), e resposta pública pelo token da consulta.
-- 4) Lembretes confiáveis: contador de tentativas (para retentar sem
--    reenviar em loop).

-- ----------------------------------------- 2) cobrança paga por link
alter table public.payment_links add column if not exists paid_at timestamptz;

alter table public.invoices
  add column if not exists paid_via_link_id uuid references public.payment_links (id) on delete set null;

create index if not exists invoices_paid_at_idx
  on public.invoices (tenant_id, paid_at desc) where status = 'paid';

-- ------------------------------------- 1) pacote consumido por consulta
create table if not exists public.package_session_uses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  package_id uuid not null references public.session_packages (id) on delete cascade,
  appointment_id uuid unique references public.appointments (id) on delete set null,
  covered_invoice_id uuid references public.invoices (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists package_session_uses_package_idx on public.package_session_uses (package_id);

alter table public.package_session_uses enable row level security;

drop policy if exists "package_session_uses_select" on public.package_session_uses;
create policy "package_session_uses_select"
  on public.package_session_uses for select
  using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('admin', 'recepcao'));

-- Só o trigger (security definer) escreve aqui.
revoke insert, update, delete on public.package_session_uses from authenticated, anon;

create or replace function public.sync_package_on_appointment_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_pkg public.session_packages;
  v_use public.package_session_uses;
  v_use_id uuid;
  v_invoice_id uuid;
begin
  if new.status = 'completed' and old.status <> 'completed' and new.patient_id is not null then
    -- Pacote ativo mais antigo do paciente, para este tipo de consulta (ou
    -- sem tipo definido), que ainda tenha saldo.
    select * into v_pkg
    from public.session_packages
    where tenant_id = new.tenant_id
      and patient_id = new.patient_id
      and status = 'active'
      and sessions_used < sessions_total
      and (service_type_id is null or service_type_id = new.service_type_id)
    order by created_at
    limit 1
    for update skip locked;

    if found then
      insert into public.package_session_uses (tenant_id, package_id, appointment_id)
      values (new.tenant_id, v_pkg.id, new.id)
      on conflict (appointment_id) do nothing
      returning id into v_use_id;

      if v_use_id is not null then
        update public.session_packages
        set sessions_used = sessions_used + 1,
            status = case when sessions_used + 1 >= sessions_total then 'completed' else 'active' end
        where id = v_pkg.id;

        -- A sessão já foi paga no pacote: a cobrança avulsa da consulta
        -- deixa de existir (senão cobraria duas vezes).
        update public.invoices
        set status = 'cancelled',
            notes = trim(coalesce(notes, '') || ' [coberta por pacote]')
        where appointment_id = new.id and status = 'pending'
        returning id into v_invoice_id;

        update public.package_session_uses set covered_invoice_id = v_invoice_id where id = v_use_id;
      end if;
    end if;

  elsif old.status = 'completed' and new.status <> 'completed' then
    select * into v_use from public.package_session_uses where appointment_id = new.id;

    if found then
      update public.session_packages
      set sessions_used = greatest(sessions_used - 1, 0),
          status = case when status = 'completed' then 'active' else status end
      where id = v_use.package_id;

      if v_use.covered_invoice_id is not null then
        update public.invoices
        set status = 'pending',
            notes = nullif(trim(replace(coalesce(notes, ''), '[coberta por pacote]', '')), '')
        where id = v_use.covered_invoice_id and status = 'cancelled';
      end if;

      delete from public.package_session_uses where id = v_use.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_sync_packages on public.appointments;
create trigger appointments_sync_packages
  after update of status on public.appointments
  for each row execute function public.sync_package_on_appointment_status();

-- ------------------------------------------ 3) pós-consulta e NPS
alter table public.appointments
  add column if not exists reminder_attempts int not null default 0,
  add column if not exists followup_sent_at timestamptz,
  add column if not exists followup_attempts int not null default 0,
  add column if not exists nps_token uuid not null default gen_random_uuid();

create unique index if not exists appointments_nps_token_idx on public.appointments (nps_token);

create index if not exists appointments_followup_idx
  on public.appointments (starts_at) where status = 'completed' and followup_sent_at is null;

create table if not exists public.nps_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  appointment_id uuid not null unique references public.appointments (id) on delete cascade,
  score smallint not null check (score between 0 and 10),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists nps_responses_tenant_idx on public.nps_responses (tenant_id, created_at desc);

alter table public.nps_responses enable row level security;

drop policy if exists "nps_responses_admin_select" on public.nps_responses;
create policy "nps_responses_admin_select"
  on public.nps_responses for select
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

revoke insert, update, delete on public.nps_responses from authenticated, anon;

-- Tela pública (sem login): o token da consulta é o segredo. Só devolve
-- o necessário para montar a pergunta — nunca dados do paciente.
create or replace function public.get_nps_info(p_token uuid)
returns table (clinic_name text, professional_name text, starts_at timestamptz, answered boolean)
language sql
security definer set search_path = public
stable
as $$
  select t.name,
         p.full_name,
         a.starts_at,
         exists (select 1 from public.nps_responses r where r.appointment_id = a.id)
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  join public.profiles p on p.id = a.professional_id
  where a.nps_token = p_token and a.status = 'completed';
$$;

create or replace function public.submit_nps(p_token uuid, p_score int, p_comment text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_appt public.appointments;
begin
  if p_score is null or p_score < 0 or p_score > 10 then
    raise exception 'Nota inválida.';
  end if;
  if length(coalesce(p_comment, '')) > 1000 then
    raise exception 'Comentário muito longo.';
  end if;

  select * into v_appt from public.appointments where nps_token = p_token and status = 'completed';
  if not found then
    raise exception 'Link inválido.';
  end if;

  insert into public.nps_responses (tenant_id, appointment_id, score, comment)
  values (v_appt.tenant_id, v_appt.id, p_score, nullif(trim(coalesce(p_comment, '')), ''))
  on conflict (appointment_id) do nothing;

  return found;
end;
$$;

revoke all on function public.get_nps_info(uuid) from public;
revoke all on function public.submit_nps(uuid, int, text) from public;
grant execute on function public.get_nps_info(uuid) to anon, authenticated;
grant execute on function public.submit_nps(uuid, int, text) to anon, authenticated;

-- ===================================================================
-- 0019_finance_consistency.sql
-- ===================================================================
-- Consistência do financeiro (revisão de 2026-10-13).
--
-- 1) Link de pagamento aberto não pode continuar valendo depois que uma das
--    cobranças dele foi paga por fora ou cancelada: o paciente ainda veria
--    (e pagaria) o valor antigo. Quando uma cobrança sai de "pending", todo
--    link ABERTO que a contém é cancelado — exceto o próprio link que a
--    pagou (invoices.paid_via_link_id).
-- 2) Baixa automática de pacote não consome sessão se a consulta já foi paga
--    avulsa (senão o paciente pagaria duas vezes pela mesma sessão).

create or replace function public.close_stale_payment_links()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    update public.payment_links
    set status = 'cancelled'
    where tenant_id = new.tenant_id
      and status = 'open'
      and new.id = any (invoice_ids)
      and id is distinct from new.paid_via_link_id;
  end if;
  return null;
end;
$$;

drop trigger if exists invoices_close_stale_links on public.invoices;
create trigger invoices_close_stale_links
  after update of status on public.invoices
  for each row execute function public.close_stale_payment_links();

create or replace function public.sync_package_on_appointment_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_pkg public.session_packages;
  v_use public.package_session_uses;
  v_use_id uuid;
  v_invoice_id uuid;
begin
  if new.status = 'completed' and old.status <> 'completed' and new.patient_id is not null then
    -- Consulta já paga avulsa: não gasta sessão do pacote.
    if exists (
      select 1 from public.invoices where appointment_id = new.id and status = 'paid'
    ) then
      return new;
    end if;

    select * into v_pkg
    from public.session_packages
    where tenant_id = new.tenant_id
      and patient_id = new.patient_id
      and status = 'active'
      and sessions_used < sessions_total
      and (service_type_id is null or service_type_id = new.service_type_id)
    order by created_at
    limit 1
    for update skip locked;

    if found then
      insert into public.package_session_uses (tenant_id, package_id, appointment_id)
      values (new.tenant_id, v_pkg.id, new.id)
      on conflict (appointment_id) do nothing
      returning id into v_use_id;

      if v_use_id is not null then
        update public.session_packages
        set sessions_used = sessions_used + 1,
            status = case when sessions_used + 1 >= sessions_total then 'completed' else 'active' end
        where id = v_pkg.id;

        update public.invoices
        set status = 'cancelled',
            notes = trim(coalesce(notes, '') || ' [coberta por pacote]')
        where appointment_id = new.id and status = 'pending'
        returning id into v_invoice_id;

        update public.package_session_uses set covered_invoice_id = v_invoice_id where id = v_use_id;
      end if;
    end if;

  elsif old.status = 'completed' and new.status <> 'completed' then
    select * into v_use from public.package_session_uses where appointment_id = new.id;

    if found then
      update public.session_packages
      set sessions_used = greatest(sessions_used - 1, 0),
          status = case when status = 'completed' then 'active' else status end
      where id = v_use.package_id;

      if v_use.covered_invoice_id is not null then
        update public.invoices
        set status = 'pending',
            notes = nullif(trim(replace(coalesce(notes, ''), '[coberta por pacote]', '')), '')
        where id = v_use.covered_invoice_id and status = 'cancelled';
      end if;

      delete from public.package_session_uses where id = v_use.id;
    end if;
  end if;

  return new;
end;
$$;

-- ===================================================================
-- 0020_payment_settings_auto_send.sql
-- ===================================================================
-- Configurações de recebimento (Pix + maquininha/adquirente) e geração +
-- envio automático do link de pagamento por WhatsApp.
--
-- 1) tenants ganha "aceita cartão" (texto livre sobre a maquininha/
--    adquirente — continua sem processar pagamento nenhum, mesma
--    categoria do Pix: só informa o paciente) e um interruptor
--    "auto_send_payment_whatsapp".
-- 2) Toda cobrança pendente nova (de agendamento com preço OU de cobrança
--    avulsa) é empacotada sozinha num link de pagamento — e só isso: o
--    app client ainda é quem manda o WhatsApp (SQL não faz HTTP). Um
--    trigger só em invoices cobre os dois jeitos de cobrança nascer sem
--    duplicar a lógica em cada server action.
-- 3) Para a página pública de agendamento (sem sessão), uma função
--    SECURITY DEFINER devolve o id do link recém-criado pra consulta —
--    anon não tem acesso de leitura a payment_links por RLS.
-- 4) get_payment_link_info passa a devolver também os dados da
--    maquininha, pra /pagar/[id] mostrar as duas opções quando a
--    clínica aceitar as duas.
--
-- IMPORTANTE (decisão de produto, não só técnica): auto_send_payment_
-- whatsapp nasce DESLIGADO por padrão — mesmo numa clínica que já tem
-- Pix configurado, ninguém decidiu ainda que o sistema deve mandar
-- mensagem pro paciente sozinho. Fica a um clique de distância em
-- Configurações.

alter table public.tenants
  add column if not exists accepts_card boolean not null default false,
  add column if not exists card_instructions text check (card_instructions is null or length(card_instructions) <= 300),
  add column if not exists auto_send_payment_whatsapp boolean not null default false;

grant update (accepts_card, card_instructions, auto_send_payment_whatsapp)
  on public.tenants to authenticated;
grant select (accepts_card, card_instructions, auto_send_payment_whatsapp)
  on public.tenants to authenticated;

-- ------------------------------------------- 2) auto-empacotar em link
create or replace function public.auto_wrap_invoice_in_payment_link()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_tenant record;
begin
  if new.status <> 'pending' or new.patient_id is null then
    return new;
  end if;

  select auto_send_payment_whatsapp, pix_key, pix_holder_name, pix_city, accepts_card
  into v_tenant
  from public.tenants
  where id = new.tenant_id;

  if not coalesce(v_tenant.auto_send_payment_whatsapp, false) then
    return new;
  end if;

  if not (
    (v_tenant.pix_key is not null and v_tenant.pix_holder_name is not null and v_tenant.pix_city is not null)
    or coalesce(v_tenant.accepts_card, false)
  ) then
    return new;
  end if;

  insert into public.payment_links (tenant_id, patient_id, invoice_ids, amount_cents)
  values (new.tenant_id, new.patient_id, array[new.id], new.amount_cents);

  return new;
end;
$$;

drop trigger if exists invoices_auto_payment_link on public.invoices;
create trigger invoices_auto_payment_link
  after insert on public.invoices
  for each row execute function public.auto_wrap_invoice_in_payment_link();

-- --------------------------- 3) leitura pública (booking sem sessão)
-- O cadastro público de agendamento (anon) não tem acesso de leitura a
-- payment_links por RLS — esta função devolve só o id do link que o
-- trigger acima pode ter criado pra essa consulta, pra montar a URL
-- /pagar/<id> na mensagem de confirmação.
create or replace function public.get_latest_payment_link_for_appointment(p_appointment_id uuid)
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select pl.id
  from public.payment_links pl
  join public.invoices i on i.id = any (pl.invoice_ids)
  where i.appointment_id = p_appointment_id
    and i.status = 'pending'
    and pl.status = 'open'
  order by pl.created_at desc
  limit 1;
$$;

revoke all on function public.get_latest_payment_link_for_appointment(uuid) from public;
grant execute on function public.get_latest_payment_link_for_appointment(uuid) to anon, authenticated;

-- -------------------------------- 4) /pagar/[id] mostrar a maquininha
drop function if exists public.get_payment_link_info(uuid);

create function public.get_payment_link_info(p_link_id uuid)
returns table (
  amount_cents int,
  status text,
  tenant_name text,
  tenant_logo_url text,
  pix_key text,
  pix_holder_name text,
  pix_city text,
  accepts_card boolean,
  card_instructions text
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
    t.pix_city,
    t.accepts_card,
    t.card_instructions
  from public.payment_links pl
  join public.tenants t on t.id = pl.tenant_id
  where pl.id = p_link_id;
$$;

revoke all on function public.get_payment_link_info(uuid) from public;
grant execute on function public.get_payment_link_info(uuid) to anon, authenticated;
