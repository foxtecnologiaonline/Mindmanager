# MindManager

Gestão para profissionais de saúde autônomos e consultórios pequenos.
Ver [`SCOPE.md`](./SCOPE.md) para o escopo completo do produto.

Stack: Next.js 16 (App Router, TS, Tailwind) + Supabase (Auth/Postgres/RLS).

## Status

- **F0 — Fundação**: cadastro (com confirmação de e-mail), login, criação
  de clínica (tenant) e perfil, isolamento de dados por tenant via RLS.
- **F1 — Agenda**: tipos de consulta, horários de trabalho por
  profissional, página pública de agendamento (`/agendar/[slug]`),
  agenda do dia no dashboard, lembrete automático por WhatsApp.

## Setup local

1. Crie um projeto em [supabase.com](https://supabase.com) (ou rode
   `supabase start` localmente com a [CLI](https://supabase.com/docs/guides/local-development)).
2. Copie `.env.example` para `.env.local` e preencha pelo menos
   `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`. As
   variáveis de Twilio/cron são opcionais (ver comentários no arquivo).
3. Aplique as migrations em `supabase/migrations/` **em ordem** (SQL
   Editor do painel Supabase, ou `supabase db push` com a CLI):
   `0001_foundation.sql` → `0002_scheduling.sql`.
4. Instale dependências e rode:

   ```bash
   npm install
   npm run dev
   ```

5. Abra [http://localhost:3000](http://localhost:3000).

## Fluxo implementado

**Onboarding**: `/signup` → confirmação por e-mail (`/auth/confirm`) →
`/onboarding` (cria o tenant/clínica) → `/dashboard`.

**Agenda**: no dashboard, `/dashboard/agenda/configuracoes` cadastra
tipos de consulta e horários de trabalho por profissional;
`/dashboard/agenda` mostra o dia e permite agendar manualmente ou
cancelar. O link público `/agendar/[slug]` (o `slug` da clínica,
mostrado no dashboard) deixa o paciente escolher profissional, serviço,
data e horário livre, sem login.

**Lembrete automático**: ao confirmar pelo link público, o paciente
recebe uma mensagem de WhatsApp (via Twilio, se configurado — sem as
credenciais, a mensagem só é logada). Um lembrete adicional ~24h antes
da consulta depende de uma chamada diária a `/api/cron/reminders`
(protegida por `CRON_SECRET`); `vercel.json` já configura isso via
Vercel Cron caso o deploy seja na Vercel.

## Estrutura relevante

```
src/lib/supabase/       clients (browser, server, middleware)
src/lib/actions.ts       server actions de auth e onboarding
src/lib/scheduling/      server actions da agenda (CRUD, slots, reserva)
src/lib/notifications/   envio de WhatsApp (Twilio)
src/proxy.ts             guarda de rotas (login/dashboard/rotas públicas)
src/app/agendar/[slug]/  página pública de agendamento
src/app/api/cron/        lembrete diário (chamado por scheduler externo)
supabase/migrations/     schema SQL (0001 fundação, 0002 agenda)
SCOPE.md                 escopo do produto e roadmap de fases (F0–F4)
```
