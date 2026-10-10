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

create policy "clinical_notes_select"
  on public.clinical_notes for select
  using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('admin', 'profissional'));

create policy "clinical_notes_insert"
  on public.clinical_notes for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'profissional')
    and author_id = auth.uid()
  );

create policy "clinical_notes_update_own"
  on public.clinical_notes for update
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'profissional')
    and author_id = auth.uid()
  )
  with check (tenant_id = public.current_tenant_id() and author_id = auth.uid());

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

create policy "patient_attachments_select"
  on public.patient_attachments for select
  using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('admin', 'profissional'));

create policy "patient_attachments_insert"
  on public.patient_attachments for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'profissional')
    and uploaded_by = auth.uid()
    and storage_path like tenant_id::text || '/' || patient_id::text || '/%'
  );

-- "Remover" = soft delete (o arquivo continua no storage por retenção).
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

create policy "patient_files_select"
  on storage.objects for select
  using (
    bucket_id = 'patient-files'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_role() in ('admin', 'profissional')
  );

create policy "patient_files_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'patient-files'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_role() in ('admin', 'profissional')
  );

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
