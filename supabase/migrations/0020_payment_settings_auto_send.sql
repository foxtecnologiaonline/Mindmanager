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
