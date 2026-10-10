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

## Scripts

```bash
npm run dev         # desenvolvimento
npm run lint        # ESLint
npm test            # testes unitários (Vitest)
npm run build       # build de produção
npm run test:e2e    # smoke E2E (Playwright; precisa de `npm run build` antes)
./supabase/tests/run.sh   # aplica TODAS as migrations num Postgres limpo + cenários de RLS
```

O CI (`.github/workflows/ci.yml`) roda lint, testes, build, E2E e as
migrations a cada push/PR.

## Setup local

1. Crie um projeto em [supabase.com](https://supabase.com) (ou rode
   `supabase start` localmente com a [CLI](https://supabase.com/docs/guides/local-development)).
2. Copie `.env.example` para `.env.local` e preencha pelo menos
   `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`. As
   variáveis de Twilio/cron são opcionais (ver comentários no arquivo).
3. Aplique as migrations em `supabase/migrations/` **em ordem** (SQL
   Editor do painel Supabase, ou `supabase db push` com a CLI):
   todos os arquivos `0001_…` até `0018_…` na ordem numérica. **Aplique as
   migrations antes de publicar o código que depende delas** (equipe/papéis
   em `0016`, prontuário em `0017`, baixa de pacote/NPS/lembretes em `0018`).
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

## Equipe e papéis (0016)

- **Administrador**: tudo. **Profissional**: agenda, pacientes, prontuário.
  **Recepção**: agenda, pacientes, financeiro (sem prontuário). Aplicado no
  banco (RLS), não só na interface.
- `/dashboard/equipe`: o admin cria um convite (e-mail + papel) e copia o
  link `/convite/<token>` — vale 7 dias, uso único e só com o e-mail
  informado. O sistema **não envia** o e-mail do convite.

## Prontuário, anexos e auditoria (0017)

- `/dashboard/pacientes/[id]/prontuario`: evolução SOAP, rascunho →
  assinatura, adendos, anexos (PDF/PNG/JPG/WEBP, 10 MB, bucket privado) e
  trilha de acessos (admin). Exige consentimento LGPD registrado.
- Evolução assinada é **imutável** no banco (nem o admin altera/apaga). A
  "assinatura" é um carimbo de integridade (SHA-256 + autor + instante) —
  **não** é assinatura digital ICP-Brasil.
- A trilha de auditoria (`audit_log`) só aceita inserção. Leituras são
  registradas pelo app; não há como interceptar `SELECT` no banco.

## Lembretes, pós-consulta e NPS (0018)

- `/api/cron/reminders` envia o lembrete de 24h e, depois da consulta
  marcada como **concluída** na agenda, a mensagem com o link de avaliação
  (`/nps/<token>`, nota 0–10). Idempotente, com até 3 tentativas por envio.
- Vercel Cron (plano gratuito) roda 1x/dia (`vercel.json`). Para rodar de
  hora em hora configure no GitHub `CRON_SECRET` (secret) e `SITE_URL`
  (variable) — `.github/workflows/reminders.yml`.
- Concluir a consulta baixa uma sessão do pacote ativo do paciente.

## Operação

- `GET /api/health` (app + Supabase Auth). O workflow `uptime.yml` chama a
  cada 15 min quando a variável `SITE_URL` está definida.
- Erros do servidor saem como JSON estruturado nos logs da Vercel
  (`src/lib/logger.ts`, `src/instrumentation.ts`). Para Sentry/Datadog,
  use um Log Drain da Vercel ou instale o SDK — requer DSN/conta.
- CSP com nonce por request em `src/proxy.ts` (páginas dinâmicas).

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
supabase/migrations/      schema SQL (0001 fundação … 0018 pacotes/NPS)
supabase/tests/           shim do Supabase + cenários de RLS (run.sh)
SCOPE.md                  escopo do produto e roadmap de fases (F0–F4)
```
