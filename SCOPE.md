# MindManager — Escopo v2

**Produto**: gestão para profissional de saúde autônomo / consultório pequeno.
SaaS multi-tenant. Sem TISS no MVP.

**Tese de venda**: profissional online e cobrando em menos de 10 minutos, sem suporte manual.

## Fora de escopo (cortado, não esquecido)
- TISS / faturamento de convênio
- Multi-unidade / múltiplas filiais
- Estoque / farmácia
- App mobile nativo
- Telemedicina com vídeo embutido
- Contabilidade completa

## Stack
- Next.js + TypeScript (App Router)
- Supabase (Postgres, Auth, Storage, RLS)
- Vercel (deploy)
- Stripe (billing)
- Twilio / WhatsApp Business API (lembretes)

## Ordem de build (cada fase é vendável isoladamente)

### F0 — Fundação (bloqueia tudo)
`tenant` · `profile` (papéis: admin / profissional / recepção) · Auth ·
RLS por tenant · ~~billing (trial → pago)~~ **desativado até segunda
ordem** — decisão do usuário em 2026-10-05: só pensar em billing/Stripe
depois do produto estar pronto. Hoje todo tenant fica em `trial`
indefinidamente, sem nenhuma trava de acesso por status de pagamento
(não existe nenhum código que bloqueie por `billing_status`/
`trial_ends_at` — são só informativos no dashboard).

### F1 — Agenda
Calendário por profissional · tipos/duração de consulta ·
agendamento público via link · lembrete automático (WhatsApp/SMS)
→ maior valor percebido, mata no-show, gancho de venda

**Configuração mínima desde 2026-10-08**: todo tenant novo já nasce com
um tipo de consulta ("Consulta", 50min) e expediente padrão (seg-sex
09:00-18:00) — editável/removível em
`/dashboard/agenda/configuracoes`. Antes disso o admin precisava
preencher os dois formulários antes do link público funcionar; agora
funciona no primeiro login, sem nenhum passo obrigatório.

### F2 — Paciente + Prontuário
~~Cadastro de paciente~~ **cadastro básico implementado em 2026-10-08**
(`/dashboard/pacientes` — nome, telefone, e-mail, observações; ainda
não ligado aos agendamentos, é um cadastro avulso). Falta: evolução
clínica (SOAP), anexos, assinatura digital do registro (CFM Resolução
1.821/2007), retenção de 20 anos desde o schema (mesmo sem UI de
exclusão).

### F3 — Financeiro
Pagamento (PIX/cartão) · contas a receber · recibo

### F4 — Retenção
Lembrete pós-consulta · NPS

### Adiado para próxima versão (decisão explícita, não esquecimento)
- **Convite de equipe**: hoje só existe o usuário que fez o cadastro
  inicial (sempre `admin`, via trigger `handle_new_user`). Não há como
  adicionar profissional/recepção ao mesmo tenant. Trava clínicas com
  mais de 1 profissional, mesmo a agenda já sendo multi-profissional
  por design. Decisão do usuário em 2026-10-02: fica para depois.
- **Painel de chat de IA** (lado direito no desktop / embaixo no
  mobile): proposto pelo usuário em 2026-10-08 (assistente pra equipe
  e/ou paciente, dentro do dashboard e/ou da página pública de
  agendamento). Decisão do usuário: "omitir por enquanto" — nem o
  objetivo (equipe vs. paciente) nem o provedor de IA foram definidos.
  Revisitar quando houver decisão sobre escopo e provedor (Claude/
  Anthropic foi a sugestão, mas não confirmada).

## Não-negociáveis (todas as fases)
- LGPD: dado de saúde é dado sensível → consentimento, criptografia, log de acesso
- Auditoria imutável em prontuário (quem / quando / o quê)
- Agenda é mission-critical → uptime monitorado desde F1

## Definição de "pronto para vender"
Cadastro → agenda configurada → paciente marca online → atendimento
registrado e assinado → cobrança → lembrete automático de retorno.
Fluxo fechado = pode cobrar.
