-- F2 (início) — cadastro básico de paciente. Avulso por agora: não tem
-- FK de appointments pra patients ainda (o booking continua gravando
-- nome/telefone direto na consulta) — ligar os dois é um passo
-- separado, pra não arriscar a lógica de overlap/booking já em uso.

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  full_name text not null,
  phone text not null,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists patients_tenant_id_idx on public.patients (tenant_id);

alter table public.patients enable row level security;

-- Qualquer membro do tenant (admin/profissional/recepção) administra
-- os pacientes da própria clínica — é tarefa administrativa comum,
-- não só de admin. current_tenant_id() (migration 0008) evita repetir
-- a subquery direta em profiles.
create policy "patients_tenant_all"
  on public.patients for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
