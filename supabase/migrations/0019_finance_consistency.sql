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
