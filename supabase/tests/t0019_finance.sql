\set ON_ERROR_STOP off
insert into auth.users (id,email,raw_user_meta_data) values ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com','{"full_name":"Alice Admin"}');
select tenant_id as tid from profiles limit 1 \gset
insert into patients (id, tenant_id, full_name, phone) values ('11111111-0000-0000-0000-000000000001', :'tid','Paciente 1','11999999999');
insert into invoices (id, tenant_id, patient_id, amount_cents) values
 ('a0000000-0000-0000-0000-000000000001', :'tid','11111111-0000-0000-0000-000000000001', 10000),
 ('a0000000-0000-0000-0000-000000000002', :'tid','11111111-0000-0000-0000-000000000001', 10000),
 ('a0000000-0000-0000-0000-000000000003', :'tid','11111111-0000-0000-0000-000000000001', 10000);
insert into payment_links (id, tenant_id, patient_id, invoice_ids, amount_cents) values
 ('b0000000-0000-0000-0000-000000000001', :'tid','11111111-0000-0000-0000-000000000001', array['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002']::uuid[], 20000),
 ('b0000000-0000-0000-0000-000000000002', :'tid','11111111-0000-0000-0000-000000000001', array['a0000000-0000-0000-0000-000000000002']::uuid[], 10000),
 ('b0000000-0000-0000-0000-000000000003', :'tid','11111111-0000-0000-0000-000000000001', array['a0000000-0000-0000-0000-000000000003']::uuid[], 10000);
\echo '--- link 1 confirma (paga as faturas 1 e 2 via link 1): link 2 (que contém a fatura 2) deve virar cancelled; link 3 segue aberto'
update invoices set status='paid', method='pix', paid_at=now(), paid_via_link_id='b0000000-0000-0000-0000-000000000001' where id in ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
update payment_links set status='paid' where id='b0000000-0000-0000-0000-000000000001';
select 'links', id::text like '%1' as l1, id::text like '%2' as l2, status from payment_links order by id;
\echo '--- fatura 3 cancelada individualmente: link 3 cancelado'
update invoices set status='cancelled' where id='a0000000-0000-0000-0000-000000000003';
select 'link3', status from payment_links where id='b0000000-0000-0000-0000-000000000003';
\echo '--- consulta já paga avulsa não consome pacote'
select id as stid from service_types limit 1 \gset
insert into session_packages (id, tenant_id, patient_id, sessions_total, amount_cents) values ('22222222-0000-0000-0000-000000000001', :'tid','11111111-0000-0000-0000-000000000001', 2, 30000);
insert into appointments (id, tenant_id, professional_id, service_type_id, patient_id, patient_name, patient_phone, starts_at, ends_at, status)
 values ('c0000000-0000-0000-0000-000000000001', :'tid','aaaaaaaa-0000-0000-0000-000000000001', :'stid','11111111-0000-0000-0000-000000000001','P','11999999999', now()-interval '2 hours', now()-interval '1 hour','confirmed');
insert into invoices (tenant_id, patient_id, appointment_id, amount_cents, status, method, paid_at) values (:'tid','11111111-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',10000,'paid','cash',now());
update appointments set status='completed' where id='c0000000-0000-0000-0000-000000000001';
select 'pacote intacto (0 usadas)', sessions_used from session_packages;
