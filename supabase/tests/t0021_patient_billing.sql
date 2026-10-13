\set ON_ERROR_STOP off
insert into auth.users (id,email,raw_user_meta_data) values ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com','{"full_name":"Alice Admin"}');
select tenant_id as tid from profiles limit 1 \gset
insert into auth.users (id,email,raw_user_meta_data) values ('bbbbbbbb-0000-0000-0000-000000000002','b@x.com','{"full_name":"Bia Prof"}');
update profiles set tenant_id = :'tid' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update profiles set role = 'profissional' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into auth.users (id,email,raw_user_meta_data) values ('cccccccc-0000-0000-0000-000000000003','c@x.com','{"full_name":"Carla Recepção"}');
update profiles set tenant_id = :'tid' where id = 'cccccccc-0000-0000-0000-000000000003';
update profiles set role = 'recepcao' where id = 'cccccccc-0000-0000-0000-000000000003';

insert into patients (id, tenant_id, full_name, phone) values ('11111111-0000-0000-0000-000000000001', :'tid','Paciente 1','11999999999');

\echo '--- admin cria o perfil de cobrança do paciente'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into patient_billing_profiles (patient_id, tenant_id, preferred_payment_method, billing_recurrence, billing_notes, updated_by)
values ('11111111-0000-0000-0000-000000000001', :'tid', 'pix', 'mensal', 'Prefere pagar todo dia 5.', auth.uid());
select 'admin le', preferred_payment_method, billing_recurrence from patient_billing_profiles;
reset role;

\echo '--- recepção também pode ler e atualizar (capability finance)'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'recepcao le', count(*) from patient_billing_profiles;
update patient_billing_profiles set billing_notes = 'Atualizado pela recepção' where patient_id = '11111111-0000-0000-0000-000000000001';
select 'recepcao editou', billing_notes from patient_billing_profiles;
reset role;

\echo '--- profissional NÃO pode ler (deve vir 0 linhas, sem erro de RLS)'
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select 'profissional le (esperado 0)', count(*) from patient_billing_profiles;
reset role;

\echo '--- profissional NÃO pode atualizar (RLS filtra a linha: 0 afetadas, sem erro)'
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
update patient_billing_profiles set billing_notes = 'tentativa indevida' where patient_id = '11111111-0000-0000-0000-000000000001';
reset role;
select 'nota não foi alterada pelo profissional', billing_notes from patient_billing_profiles;

\echo '--- paciente de outro tenant: trigger deve rejeitar (ERROR)'
insert into tenants (name, slug) values ('Outra clínica', 'outra-clinica') returning id as other_tid \gset
insert into patients (id, tenant_id, full_name, phone) values ('22222222-0000-0000-0000-000000000002', :'other_tid', 'Paciente 2', '11988888888');
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into patient_billing_profiles (patient_id, tenant_id) values ('22222222-0000-0000-0000-000000000002', :'tid');
reset role;
