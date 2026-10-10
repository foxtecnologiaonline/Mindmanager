\set ON_ERROR_STOP off
insert into auth.users (id,email,raw_user_meta_data) values ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com','{"full_name":"Alice Admin"}');
select tenant_id as tid from profiles limit 1 \gset
select id as stid from service_types limit 1 \gset
update service_types set price_cents = 15000;
insert into patients (id, tenant_id, full_name, phone) values ('11111111-0000-0000-0000-000000000001', :'tid','Paciente 1','11999999999');
-- pacote pago antecipado: 2 sessões
insert into session_packages (id, tenant_id, patient_id, sessions_total, amount_cents) values ('22222222-0000-0000-0000-000000000001', :'tid','11111111-0000-0000-0000-000000000001', 2, 30000);
-- 3 consultas agendadas (via book_appointment como staff)
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select slug as sl from tenants \gset
select book_appointment(:'sl','aaaaaaaa-0000-0000-0000-000000000001', :'stid','Paciente 1','11999999999',null, now()+interval '2 days') is not null as a1;
select book_appointment(:'sl','aaaaaaaa-0000-0000-0000-000000000001', :'stid','Paciente 1','11999999999',null, now()+interval '3 days') is not null as a2;
select book_appointment(:'sl','aaaaaaaa-0000-0000-0000-000000000001', :'stid','Paciente 1','11999999999',null, now()+interval '4 days') is not null as a3;
reset role;
select 'faturas pendentes', count(*) from invoices where status='pending';
\echo '--- concluir 1 e 2 (consomem pacote), 3 (sem saldo)'
with a as (select id, row_number() over (order by starts_at) rn from appointments)
update appointments set status='completed' where id in (select id from a where rn<=3) ;
select 'pacote', sessions_used, status from session_packages;
select 'usos', count(*) from package_session_uses;
select 'faturas', status, count(*) from invoices group by status order by status;
select 'nota fatura coberta', notes from invoices where notes is not null;
\echo '--- reverter a consulta 1 -> pacote volta a ativo e fatura reabre'
update appointments set status='confirmed' where id = (select id from appointments order by starts_at limit 1);
select 'pacote após reverter', sessions_used, status from session_packages;
select 'faturas após', status, count(*) from invoices group by status order by status;
select 'notas', notes from invoices where notes is not null;
\echo '--- NPS'
select nps_token as tok from appointments where status='completed' limit 1 \gset
select nps_token as tok_pend from appointments where status<>'completed' limit 1 \gset
set role anon;
select 'info', clinic_name, professional_name, answered from get_nps_info(:'tok'::uuid);
select 'info nao concluída (0 linhas)', count(*) from get_nps_info(:'tok_pend'::uuid);
select submit_nps(:'tok'::uuid, 9, 'Ótimo atendimento');
select submit_nps(:'tok'::uuid, 3, 'segunda tentativa');
select submit_nps(:'tok'::uuid, 11, 'x');
select submit_nps(:'tok_pend'::uuid, 8, 'x');
select 'direct select nps anon', count(*) from nps_responses;
reset role;
select 'respostas', score, comment from nps_responses;
