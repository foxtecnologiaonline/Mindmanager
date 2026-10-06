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
  WhatsApp (resposta "1"/"2", via ZapScript ou Twilio), cada clínica
  pode usar o número compartilhado da plataforma ou conectar o próprio
  número via ZapScript.

## Setup local

1. Crie um projeto em [supabase.com](https://supabase.com) (ou rode
   `supabase start` localmente com a [CLI](https://supabase.com/docs/guides/local-development)).
2. Copie `.env.example` para `.env.local` e preencha pelo menos
   `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`. As
   variáveis de Twilio/cron são opcionais (ver comentários no arquivo).
3. Aplique as migrations em `supabase/migrations/` **em ordem** (SQL
   Editor do painel Supabase, ou `supabase db push` com a CLI):
   `0001_foundation.sql` → `0002_scheduling.sql` → `0003_booking_hardening.sql`
   → `0004_patient_confirmation.sql` → `0005_perf_rate_limit_branding.sql`
   → `0006_own_whatsapp_number.sql` → `0007_auto_tenant_on_signup.sql`.
4. Instale dependências e rode:

   ```bash
   npm install
   npm run dev
   ```

5. Abra [http://localhost:3000](http://localhost:3000).

## Fluxo implementado

**Onboarding**: `/signup` → (confirmação por e-mail via `/auth/confirm`,
se "Confirm email" estiver ativo no projeto Supabase) → `/dashboard`.
O tenant/clínica nasce automaticamente no trigger de signup (migration
`0007`), com nome padrão — sem pergunta extra no meio. `/onboarding`
só existe como fallback de segurança (provisiona um tenant se faltar,
sem pedir nada, e redireciona).

**Agenda**: no dashboard, `/dashboard/agenda/configuracoes` cadastra
tipos de consulta e horários de trabalho por profissional;
`/dashboard/agenda` mostra um calendário do dia (grade horário ×
profissional) e permite agendar manualmente, confirmar ou cancelar. O
link público `/agendar/[slug]` (o `slug` da clínica, mostrado no
dashboard) deixa o paciente escolher profissional, serviço, data e
horário livre, sem login.

**Confirmação por WhatsApp (1/2)**: todo agendamento novo nasce como
`pending`. Logo depois de marcar (público ou manual), o paciente
recebe uma mensagem perguntando se confirma — responder **1** marca
como `confirmed`, **2** cancela a vaga (libera o horário). A equipe
também pode confirmar manualmente pelo calendário, sem depender da
resposta do paciente (fallback para quando nenhum provedor de WhatsApp
está configurado, ou o paciente liga em vez de responder a mensagem).
Um lembrete adicional ~24h antes da consulta depende de uma chamada
diária a `/api/cron/reminders` (protegida por `CRON_SECRET`);
`vercel.json` já configura isso via Vercel Cron caso o deploy seja na
Vercel.

A resposta do paciente usa "1"/"2" em vez de "SIM"/"NÃO" porque o
ZapScript reserva SIM/NÃO/CANCELAR/PARAR/SAIR/STOP/UNSUBSCRIBE para
opt-in/opt-out de campanha — essas palavras seriam interceptadas antes
de chegar no nosso webhook. "Sim"/"não" e variantes ainda são aceitos
como sinônimos (ver `src/lib/notifications/reply-matching.ts`), mas o
texto sugerido ao paciente é sempre "1"/"2".

### Provedor de WhatsApp: ZapScript (preferencial)

1. No painel do ZapScript, crie uma API key com o scope
   `messages:send` → vira `ZAPSCRIPT_API_KEY`.
2. Pegue o ID do número de WhatsApp conectado → `ZAPSCRIPT_NUMBER_ID`.
3. Registre o webhook de resposta (uma vez só, depois do deploy, com o
   domínio final):

   ```bash
   curl -X POST https://api.zapscript.me/public/v1/webhooks \
     -H "X-Api-Key: $ZAPSCRIPT_API_KEY" -H "Content-Type: application/json" \
     -d '{"url":"https://<seu-domínio>/api/webhooks/zapscript","events":["message.received"]}'
   ```

   A resposta traz um `secret` → vira `ZAPSCRIPT_WEBHOOK_SECRET`.
4. Configure as 3 variáveis (`ZAPSCRIPT_API_KEY`, `ZAPSCRIPT_NUMBER_ID`,
   `ZAPSCRIPT_WEBHOOK_SECRET`) no ambiente (Vercel ou `.env.local`).

Com essas variáveis presentes, o envio usa o ZapScript automaticamente
(ver prioridade de provedores em `src/lib/notifications/whatsapp.ts`).

### Provedor de WhatsApp: Twilio (fallback)

Se as variáveis do ZapScript não estiverem configuradas, mas
`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_WHATSAPP_FROM`
estiverem, o envio usa o Twilio. Configure no console do Twilio
(WhatsApp Sandbox ou número de produção), em "A message comes in"
(webhook de inbound), a URL exata:

```
https://<seu-domínio>/api/webhooks/twilio-whatsapp
```

Sem `TWILIO_AUTH_TOKEN` configurado, essa rota recusa toda requisição
(não dá para validar que ela realmente veio do Twilio).

Sem nenhum dos dois provedores configurado, o envio cai para um log no
console (não quebra o agendamento) e o fluxo funciona só via
confirmação manual pela equipe.

## Número de WhatsApp: compartilhado ou próprio (0006)

Por padrão, toda clínica manda mensagens pelo número **compartilhado**
da plataforma (`ZAPSCRIPT_API_KEY`/`ZAPSCRIPT_NUMBER_ID` do ambiente).
Em `/dashboard/agenda/configuracoes` (só admin), a clínica pode
conectar o **próprio** número de WhatsApp — self-service, sem precisar
de ninguém da plataforma fazer nada:

1. A clínica conecta o WhatsApp dela no painel do ZapScript (QR code —
   isso é feito no produto ZapScript, fora do MindManager).
2. Cria uma API key própria com os scopes `messages:send` e
   `webhooks:manage`.
3. Cola a API key em "Número de WhatsApp" → o MindManager busca os
   números conectados dessa conta (`GET /public/v1/numbers`), a clínica
   escolhe um, e o sistema registra o webhook de resposta sozinho
   (`POST /public/v1/webhooks`, com a URL dedicada
   `/api/webhooks/zapscript/<tenantId>`), guardando o secret retornado.

A partir daí, tudo desse tenant (pergunta de confirmação, lembrete
24h, resposta do paciente) passa pelo número próprio — `resolveWhatsappSender`
(`src/lib/notifications/sender-config.ts`) decide isso por tenant, lendo
`tenants.whatsapp_mode` via service role (a API key e o secret do
webhook nunca voltam pro client: `select` revogado para `authenticated`
na migration `0006`). Desconectar volta pro número compartilhado e
limpa as credenciais salvas.

Número próprio via **Twilio não é suportado** nesse fluxo: validar um
número de produção na API do WhatsApp Business via Twilio exige
aprovação da Meta por número, feita manualmente fora do app — não é
self-service como no ZapScript (que é produto da própria plataforma).

## Performance, branding e rate limiting (0005)

- **Logo da clínica**: em `/dashboard/agenda/configuracoes`, envie uma
  imagem (PNG/JPG/WEBP/SVG, até 2MB) — fica salva no bucket público
  `tenant-logos` do Supabase Storage e aparece no dashboard e na
  página pública de agendamento. A migration `0005` cria o bucket e as
  policies (cada clínica só escreve na própria pasta, `tenant_id/...`).
- **Rate limiting**: `bookPublicAppointment` (5/min por IP) e
  `getAvailableSlots` (30/min por IP) usam a função SQL
  `check_rate_limit` (também da migration `0005`) — atômica mesmo em
  ambiente serverless (Vercel), ao contrário de um contador em memória.
- **Cache da página pública**: `/agendar/[slug]` usa um client Supabase
  sem cookies (`src/lib/supabase/public.ts`) para poder cachear por 60s
  (`revalidate`) — evita bater no banco a cada visita.

## Estrutura relevante

```
src/lib/supabase/        clients (browser, server, middleware)
src/lib/actions.ts        server actions de auth e onboarding
src/lib/scheduling/       server actions da agenda (CRUD, slots, reserva)
src/lib/notifications/    envio de WhatsApp (ZapScript/Twilio) e textos das mensagens
src/proxy.ts              guarda de rotas (login/dashboard/rotas públicas)
src/app/agendar/[slug]/   página pública de agendamento
src/app/api/cron/         lembrete diário (chamado por scheduler externo)
src/app/api/webhooks/     resposta 1/2 do paciente via WhatsApp (ZapScript/Twilio)
src/lib/integrations/     conexão de WhatsApp próprio por tenant (ZapScript)
supabase/migrations/      schema SQL (0001 fundação … 0007 tenant automático)
SCOPE.md                  escopo do produto e roadmap de fases (F0–F4)
```
