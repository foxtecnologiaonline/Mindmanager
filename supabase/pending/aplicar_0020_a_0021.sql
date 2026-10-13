-- MindManager: migrations 0020 a 0021 num arquivo só.
-- Pode ser colado inteiro no SQL Editor do Supabase (é re-executável).

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

-- ===================================================================
-- 0021_patient_billing_profile.sql
-- ===================================================================
-- Aba Financeiro por paciente: forma de recebimento preferida,
-- recorrência (classificação informativa) e observações de cobrança.
--
-- Por que uma tabela nova em vez de colunas em "patients": GRANT/REVOKE
-- de coluna no Postgres só distingue ROLE do Postgres (anon/authenticated/
-- service_role) — não dá pra esconder uma coluna de "profissional" e
-- mostrar pra "recepção" quando os dois são o mesmo role authenticated.
-- A policy de patients (patients_tenant_all, migration 0009) dá leitura/
-- escrita total da linha pra qualquer papel do tenant, incluindo
-- profissional — e dado financeiro é admin+recepção por permissions.ts.
-- Mesma solução já usada pra invoices/session_packages/payment_links
-- (só finance) e clinical_notes/patient_attachments (só clinical):
-- tabela própria, com a própria RLS.
--
-- IMPORTANTE (decisão de produto): "recorrência" aqui é só uma
-- classificação informativa (avulso/pacote/mensal) pra organizar a tela —
-- não existe geração automática de cobrança recorrente/mensal. Pacotes
-- de sessão continuam em session_packages (migration 0014), com consumo
-- automático já existente (migration 0018). "Conciliação automática" é
-- feita na aplicação (totais calculados + verificação de consistência
-- entre invoices.paid_via_link_id e payment_links.status) — não há
-- integração bancária nem gateway de pagamento no projeto.

create table if not exists public.patient_billing_profiles (
  patient_id uuid primary key references public.patients (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  preferred_payment_method text check (preferred_payment_method in ('pix', 'card', 'cash', 'other')),
  billing_recurrence text not null default 'avulso' check (billing_recurrence in ('avulso', 'pacote', 'mensal')),
  billing_notes text check (billing_notes is null or length(billing_notes) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create index if not exists patient_billing_profiles_tenant_id_idx
  on public.patient_billing_profiles (tenant_id);

alter table public.patient_billing_profiles enable row level security;

drop policy if exists "patient_billing_profiles_finance_roles" on public.patient_billing_profiles;
create policy "patient_billing_profiles_finance_roles"
  on public.patient_billing_profiles for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('admin', 'recepcao'))
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() in ('admin', 'recepcao'));

-- Mesma função/padrão de 0015/0017: um branch novo pro nome da tabela,
-- em vez de duplicar a checagem numa função só pra esta tabela.
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

  elsif tg_table_name = 'patient_billing_profiles' then
    if not exists (select 1 from public.patients where id = new.patient_id and tenant_id = new.tenant_id) then
      raise exception 'Paciente inválido para esta clínica.';
    end if;
    if new.updated_by is not null
       and not exists (select 1 from public.profiles where id = new.updated_by and tenant_id = new.tenant_id) then
      raise exception 'Usuário inválido para esta clínica.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists patient_billing_profiles_same_tenant on public.patient_billing_profiles;
create trigger patient_billing_profiles_same_tenant
  before insert or update of patient_id, updated_by on public.patient_billing_profiles
  for each row execute function public.enforce_same_tenant_refs();
