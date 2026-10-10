\set ON_ERROR_STOP off
insert into auth.users (id,email,raw_user_meta_data) values ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com','{"full_name":"Alice Admin"}');
select 'tenant criado', count(*) from tenants;
-- convite como admin
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into team_invites (tenant_id,email,role,invited_by) select tenant_id,'b@x.com','recepcao',id from profiles where id=auth.uid();
insert into team_invites (tenant_id,email,role,invited_by) select tenant_id,'c@x.com','profissional',id from profiles where id=auth.uid();
select 'convites visíveis p/ admin', count(*) from team_invites;
reset role;
\gset
select token as tok_b from team_invites where email='b@x.com' \gset
select token as tok_c from team_invites where email='c@x.com' \gset
-- anon vê info
set role anon; select 'info convite', tenant_name, role, email from get_invite_info(:'tok_b'); reset role;
-- e-mail errado
insert into auth.users (id,email,raw_user_meta_data) values ('bbbbbbbb-0000-0000-0000-000000000002','hacker@x.com', jsonb_build_object('full_name','H','invite_token',:'tok_b'));
-- certo
insert into auth.users (id,email,raw_user_meta_data) values ('bbbbbbbb-0000-0000-0000-000000000002','b@x.com', jsonb_build_object('full_name','Bia Recepção','invite_token',:'tok_b'));
insert into auth.users (id,email,raw_user_meta_data) values ('cccccccc-0000-0000-0000-000000000003','c@x.com', jsonb_build_object('full_name','Caio Prof','invite_token',:'tok_c'));
-- reuso do token
insert into auth.users (id,email,raw_user_meta_data) values ('dddddddd-0000-0000-0000-000000000004','b@x.com', jsonb_build_object('full_name','Dup','invite_token',:'tok_b'));
select 'perfis', full_name, role, (tenant_id = (select tenant_id from profiles where full_name='Alice Admin')) as mesma_clinica from profiles order by full_name;
select 'horario do prof', count(*) from working_hours where professional_id='cccccccc-0000-0000-0000-000000000003';
select 'tenants total (deve ser 1)', count(*) from tenants;
-- papéis no RLS
insert into patients (tenant_id, full_name, phone) select tenant_id,'Paciente 1','11999999999' from profiles where full_name='Alice Admin';
insert into invoices (tenant_id, patient_id, amount_cents) select tenant_id, (select id from patients limit 1), 10000 from profiles where full_name='Alice Admin';
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select 'recepcao vê invoices', count(*) from invoices;
insert into service_types (tenant_id,name,duration_minutes) select tenant_id,'X',30 from profiles where id=auth.uid();
select 'recepcao vê convites (0)', count(*) from team_invites;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select 'profissional vê invoices (0)', count(*) from invoices;
select 'profissional vê pacientes (1)', count(*) from patients;
select set_member_role('bbbbbbbb-0000-0000-0000-000000000002','admin');
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'admin lê invoices', count(*) from invoices;
select set_member_role('aaaaaaaa-0000-0000-0000-000000000001','recepcao'); -- último admin: erro
select set_member_role('bbbbbbbb-0000-0000-0000-000000000002','admin');
select set_member_role('aaaaaaaa-0000-0000-0000-000000000001','profissional'); -- agora ok
select remove_member('aaaaaaaa-0000-0000-0000-000000000001'); -- a si mesmo (já não é admin) -> erro papel
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select remove_member('cccccccc-0000-0000-0000-000000000003');
reset role;
select 'após remoção', full_name, role, tenant_id is null as sem_clinica from profiles order by full_name;
