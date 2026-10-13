\set ON_ERROR_STOP off
insert into auth.users (id,email,raw_user_meta_data) values ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com','{"full_name":"Alice Admin"}');
select tenant_id as tid from profiles limit 1 \gset
select id as stid from service_types limit 1 \gset
select slug as sl from tenants where id = :'tid' \gset
update service_types set price_cents = 15000 where id = :'stid';
insert into patients (id, tenant_id, full_name, phone) values ('11111111-0000-0000-0000-000000000001', :'tid','Paciente 1','11999999999');

\echo '--- sem configuração nenhuma (toggle desligado por padrão): cobrança nasce sem link'
insert into invoices (tenant_id, patient_id, amount_cents) values (:'tid','11111111-0000-0000-0000-000000000001', 10000);
select 'sem config', count(*) from payment_links;

\echo '--- liga o auto-envio mas sem Pix/cartão configurado: ainda não empacota'
update tenants set auto_send_payment_whatsapp = true where id = :'tid';
insert into invoices (tenant_id, patient_id, amount_cents) values (:'tid','11111111-0000-0000-0000-000000000001', 10000);
select 'toggle on, sem metodo', count(*) from payment_links;

\echo '--- configura Pix: cobrança avulsa nova já nasce com link'
update tenants set pix_key='clinica@x.com', pix_holder_name='Clinica', pix_city='Sao Paulo' where id = :'tid';
insert into invoices (id, tenant_id, patient_id, amount_cents) values ('a0000000-0000-0000-0000-000000000001', :'tid','11111111-0000-0000-0000-000000000001', 20000);
select 'pix configurado', status, amount_cents, invoice_ids = array['a0000000-0000-0000-0000-000000000001'::uuid] as so_essa from payment_links order by created_at desc limit 1;

\echo '--- cobrança já paga (pacote) não gera link'
insert into invoices (tenant_id, patient_id, amount_cents, status, method, paid_at) values (:'tid','11111111-0000-0000-0000-000000000001', 30000, 'paid', 'pix', now());
select 'total de links (ainda 1)', count(*) from payment_links;

\echo '--- só maquininha (sem pix) também empacota'
update tenants set pix_key=null, pix_holder_name=null, pix_city=null, accepts_card=true, card_instructions='Maquininha na recepção, até 3x' where id = :'tid';
insert into invoices (id, tenant_id, patient_id, amount_cents) values ('a0000000-0000-0000-0000-000000000002', :'tid','11111111-0000-0000-0000-000000000001', 5000);
select 'so cartao', count(*) from payment_links where invoice_ids = array['a0000000-0000-0000-0000-000000000002'::uuid];

\echo '--- get_payment_link_info devolve os campos da maquininha'
select id as link_id from payment_links where invoice_ids = array['a0000000-0000-0000-0000-000000000002'::uuid] \gset
set role anon;
select 'info publica', accepts_card, card_instructions, pix_key from get_payment_link_info(:'link_id'::uuid);
reset role;

\echo '--- book_appointment (via staff) com pix de volta: RPC de lookup por consulta'
update tenants set pix_key='clinica@x.com', pix_holder_name='Clinica', pix_city='Sao Paulo' where id = :'tid';
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select (book_appointment(:'sl', 'aaaaaaaa-0000-0000-0000-000000000001', :'stid', 'Paciente 1', '11999999999', null, now() + interval '2 days')).id as appt_id \gset
reset role;
set role anon;
select 'link da consulta (anon)', get_latest_payment_link_for_appointment(:'appt_id'::uuid) is not null as achou;
reset role;

\echo '--- consulta sem link (tenant sem auto-envio) devolve null'
update tenants set auto_send_payment_whatsapp = false where id = :'tid';
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select (book_appointment(:'sl', 'aaaaaaaa-0000-0000-0000-000000000001', :'stid', 'Paciente 1', '11999999999', null, now() + interval '3 days')).id as appt2_id \gset
reset role;
set role anon;
select 'sem link (toggle off)', get_latest_payment_link_for_appointment(:'appt2_id'::uuid) is null as correto;
reset role;

\echo '--- card_instructions muito longo é rejeitado'
update tenants set card_instructions = repeat('x', 301) where id = :'tid';
