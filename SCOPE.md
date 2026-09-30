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
RLS por tenant · billing (trial → pago)

### F1 — Agenda
Calendário por profissional · tipos/duração de consulta ·
agendamento público via link · lembrete automático (WhatsApp/SMS)
→ maior valor percebido, mata no-show, gancho de venda

### F2 — Paciente + Prontuário
Cadastro de paciente · evolução clínica (SOAP) · anexos ·
assinatura digital do registro (CFM Resolução 1.821/2007) ·
retenção de 20 anos desde o schema (mesmo sem UI de exclusão)

### F3 — Financeiro
Pagamento (PIX/cartão) · contas a receber · recibo

### F4 — Retenção
Lembrete pós-consulta · NPS

## Não-negociáveis (todas as fases)
- LGPD: dado de saúde é dado sensível → consentimento, criptografia, log de acesso
- Auditoria imutável em prontuário (quem / quando / o quê)
- Agenda é mission-critical → uptime monitorado desde F1

## Definição de "pronto para vender"
Cadastro → agenda configurada → paciente marca online → atendimento
registrado e assinado → cobrança → lembrete automático de retorno.
Fluxo fechado = pode cobrar.
