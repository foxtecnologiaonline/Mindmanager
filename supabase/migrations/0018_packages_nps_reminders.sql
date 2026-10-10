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
