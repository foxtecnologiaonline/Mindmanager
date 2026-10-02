# MindManager

Gestão para profissionais de saúde autônomos e consultórios pequenos.
Ver [`SCOPE.md`](./SCOPE.md) para o escopo completo do produto.

Stack: Next.js 16 (App Router, TS, Tailwind) + Supabase (Auth/Postgres/RLS).

## Status

- **F0 — Fundação**: cadastro (com confirmação de e-mail), login, criação
  de clínica (tenant) e perfil, isolamento de dados por tenant via RLS.
- **F1 — Agenda**: tipos de consulta, horários de trabalho por
  profissional, página pública de agendamento (`/agendar/[slug]`),
  calendário visual no dashboard, confirmação de agendamento por
  SIM/NÃO via WhatsApp.

## Setup local

1. Crie um projeto em [supabase.com](https://supabase.com) (ou rode
   `supabase start` localmente com a [CLI](https://supabase.com/docs/guides/local-development)).
2. Copie `.env.example` para `.env.local` e preencha pelo menos
   `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`. As
   variáveis de Twilio/cron são opcionais (ver comentários no arquivo).
3. Aplique as migrations em `supabase/migrations/` **em ordem** (SQL
   Editor do painel Supabase, ou `supabase db push` com a CLI):
   `0001_foundation.sql` → `0002_scheduling.sql` → `0003_booking_hardening.sql`
   → `0004_patient_confirmation.sql`.
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
`/dashboard/agenda` mostra um calendário do dia (grade horário ×
profissional) e permite agendar manualmente, confirmar ou cancelar. O
link público `/agendar/[slug]` (o `slug` da clínica, mostrado no
dashboard) deixa o paciente escolher profissional, serviço, data e
horário livre, sem login.

**Confirmação por WhatsApp (SIM/NÃO)**: todo agendamento novo nasce
como `pending`. Logo depois de marcar (público ou manual), o paciente
recebe uma mensagem perguntando se confirma — responder **SIM** marca
como `confirmed`, **NÃO** cancela a vaga (libera o horário). A equipe
também pode confirmar manualmente pelo calendário, sem depender da
resposta do paciente (fallback para quando o Twilio não está
configurado, ou o paciente liga em vez de responder a mensagem). Um
lembrete adicional ~24h antes da consulta depende de uma chamada
diária a `/api/cron/reminders` (protegida por `CRON_SECRET`);
`vercel.json` já configura isso via Vercel Cron caso o deploy seja na
Vercel.

Para a resposta do paciente funcionar automaticamente, configure no
console do Twilio (WhatsApp Sandbox ou número de produção), em
"A message comes in" (webhook de inbound), a URL exata:

```
https://<seu-domínio>/api/webhooks/twilio-whatsapp
```

Sem `TWILIO_AUTH_TOKEN` configurado, essa rota recusa toda requisição
(não dá para validar que ela realmente veio do Twilio) — nesse caso o
fluxo ainda funciona via confirmação manual pela equipe.

## Estrutura relevante

```
src/lib/supabase/        clients (browser, server, middleware)
src/lib/actions.ts        server actions de auth e onboarding
src/lib/scheduling/       server actions da agenda (CRUD, slots, reserva)
src/lib/notifications/    envio de WhatsApp (Twilio) e textos das mensagens
src/proxy.ts              guarda de rotas (login/dashboard/rotas públicas)
src/app/agendar/[slug]/   página pública de agendamento
src/app/api/cron/         lembrete diário (chamado por scheduler externo)
src/app/api/webhooks/     resposta SIM/NÃO do paciente via WhatsApp
supabase/migrations/      schema SQL (0001 fundação … 0004 confirmação)
SCOPE.md                  escopo do produto e roadmap de fases (F0–F4)
```
