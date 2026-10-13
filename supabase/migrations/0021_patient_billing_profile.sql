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
