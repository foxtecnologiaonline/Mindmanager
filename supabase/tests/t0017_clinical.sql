\set ON_ERROR_STOP off
insert into auth.users (id,email,raw_user_meta_data) values ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com','{"full_name":"Alice Admin"}');
insert into auth.users (id,email,raw_user_meta_data) values ('eeeeeeee-0000-0000-0000-000000000009','o@x.com','{"full_name":"Outro Admin"}');
insert into patients (id, tenant_id, full_name, phone) select '11111111-0000-0000-0000-000000000001', tenant_id,'Paciente 1','11999999999' from profiles where id='aaaaaaaa-0000-0000-0000-000000000001';
-- recepção convidada
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into team_invites (tenant_id,email,role) select tenant_id,'r@x.com','recepcao' from profiles where id=auth.uid();
reset role;
select token as tok from team_invites \gset
insert into auth.users (id,email,raw_user_meta_data) values ('bbbbbbbb-0000-0000-0000-000000000002','r@x.com', jsonb_build_object('full_name','Rita Recepção','invite_token',:'tok'));

set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
\echo '--- criar rascunho'
insert into clinical_notes (tenant_id, patient_id, author_id, subjective, plan) values (current_tenant_id(), '11111111-0000-0000-0000-000000000001', auth.uid(), 'Queixa X', 'Retorno em 7 dias');
select 'rascunho', status, content_hash is null as sem_hash from clinical_notes;
update clinical_notes set subjective = 'Queixa X editada';
\echo '--- forjar assinatura direto (colunas bloqueadas)'
update clinical_notes set content_hash = 'fake', signed_at = now();
\echo '--- assinar'
update clinical_notes set status = 'signed';
select 'assinada', status, length(content_hash) as hash_len, content_hash = clinical_note_hash(n) as hash_confere from clinical_notes n;
\echo '--- editar assinada (deve falhar)'
update clinical_notes set subjective = 'adulterado';
\echo '--- apagar assinada (deve falhar)'
delete from clinical_notes;
\echo '--- adendo'
insert into clinical_notes (tenant_id, patient_id, author_id, parent_id, subjective) select tenant_id, patient_id, author_id, id, 'Adendo: paciente ligou' from clinical_notes where status='signed';
update clinical_notes set status='signed' where parent_id is not null;
select 'notas', count(*), count(*) filter (where parent_id is not null) as adendos from clinical_notes;
\echo '--- adendo de rascunho/outra nota inválida'
insert into clinical_notes (tenant_id, patient_id, author_id, parent_id) select tenant_id, patient_id, author_id, gen_random_uuid() from clinical_notes limit 1;
\echo '--- log de leitura + auditoria'
select log_access('record.view','patient','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
select log_access('hack','x',null);
select 'auditoria (admin lê)', action from audit_log order by id;
update audit_log set action='x';
delete from audit_log;
insert into audit_log (tenant_id, action, entity) values (current_tenant_id(),'fake','x');
\echo '--- recepção'
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select 'recepcao vê notas (0)', count(*) from clinical_notes;
select 'recepcao vê auditoria (0)', count(*) from audit_log;
select log_access('record.view','patient',null);
insert into clinical_notes (tenant_id, patient_id, author_id) select tenant_id,'11111111-0000-0000-0000-000000000001',id from profiles where id=auth.uid();
\echo '--- outra clínica'
set request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000009';
select 'outro admin vê notas (0)', count(*) from clinical_notes;
insert into clinical_notes (tenant_id, patient_id, author_id) select tenant_id,'11111111-0000-0000-0000-000000000001',id from profiles where id=auth.uid();
\echo '--- anexos'
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into patient_attachments (tenant_id, patient_id, uploaded_by, file_name, storage_path, mime_type, size_bytes) select tenant_id,'11111111-0000-0000-0000-000000000001',auth.uid(),'exame.pdf', tenant_id::text||'/11111111-0000-0000-0000-000000000001/abc-exame.pdf','application/pdf',1234 from profiles where id=auth.uid();
insert into patient_attachments (tenant_id, patient_id, uploaded_by, file_name, storage_path, mime_type, size_bytes) select tenant_id,'11111111-0000-0000-0000-000000000001',auth.uid(),'x.pdf', 'outra-pasta/x.pdf','application/pdf',1 from profiles where id=auth.uid();
update patient_attachments set deleted_at = now();
update patient_attachments set file_name = 'troca.pdf';
delete from patient_attachments;
reset role;
select 'auditoria final', action, entity from audit_log order by id;

\echo '--- verify_patient_notes e consentimento'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'integridade', intact from verify_patient_notes('11111111-0000-0000-0000-000000000001');
update patients set consent_at = now(), consent_recorded_by = auth.uid() where id = '11111111-0000-0000-0000-000000000001';
select log_access('record.view','patient','11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
reset role;
select 'visualizações (dedupe 5 min => 1)', count(*) from audit_log where action='record.view';
select 'consent auditado', count(*) from audit_log where action='patient.consent';
