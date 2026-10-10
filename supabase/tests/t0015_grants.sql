\set ON_ERROR_STOP off
insert into auth.users (id,email,raw_user_meta_data) values ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com','{"full_name":"Alice"}');
insert into auth.users (id,email,raw_user_meta_data) values ('bbbbbbbb-0000-0000-0000-000000000002','b@x.com','{"full_name":"Bob"}');
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'tenant_id update', has_column_privilege('authenticated','public.profiles','tenant_id','UPDATE'), 'api_key select', has_column_privilege('authenticated','public.tenants','whatsapp_api_key','SELECT');
update profiles set tenant_id = (select id from tenants where name='Bob');
update profiles set role='admin' where id = auth.uid();
select whatsapp_api_key from tenants;
select name, pix_key from tenants where id = current_tenant_id();
update tenants set pix_key='abc' where id = current_tenant_id();
update tenants set name='hack' where id = current_tenant_id();
select 'pix', pix_key from tenants where id = current_tenant_id();
