# MindManager

Gestão para profissionais de saúde autônomos e consultórios pequenos.
Ver [`SCOPE.md`](./SCOPE.md) para o escopo completo do produto.

Stack: Next.js (App Router, TS, Tailwind) + Supabase (Auth/Postgres/RLS).

## Status

**F0 — Fundação** implementado: cadastro, login, criação de clínica
(tenant) e perfil, com isolamento de dados por tenant via RLS.

## Setup local

1. Crie um projeto em [supabase.com](https://supabase.com) (ou rode
   `supabase start` localmente com a [CLI](https://supabase.com/docs/guides/local-development)).
2. Copie `.env.example` para `.env.local` e preencha com a URL e a
   `anon key` do projeto Supabase.
3. Aplique a migration em `supabase/migrations/0001_foundation.sql`
   (SQL Editor do painel Supabase, ou `supabase db push` com a CLI).
4. Instale dependências e rode:

   ```bash
   npm install
   npm run dev
   ```

5. Abra [http://localhost:3000](http://localhost:3000).

## Fluxo implementado

`/signup` → cria usuário no Supabase Auth (trigger cria o `profile`
automaticamente, sem tenant) → `/onboarding` → cria o `tenant`
(clínica) e vincula ao `profile` → `/dashboard` (protegido por
middleware).

## Estrutura relevante

```
src/lib/supabase/    clients (browser, server, middleware)
src/lib/actions.ts   server actions de auth e onboarding
src/middleware.ts    guarda de rotas (redirect login/dashboard)
supabase/migrations/ schema SQL (tenants, profiles, RLS)
SCOPE.md             escopo do produto e roadmap de fases (F0–F4)
```
