# MindManager — Escopo v2

**Produto**: gestão para profissional de saúde autônomo / consultório pequeno.
SaaS multi-tenant. Sem TISS no MVP.

**Tese de venda**: profissional online e cobrando em menos de 10 minutos, sem suporte manual.

## UI/UX (2026-10-09)
Revisão de layout/navegação/UX aplicada a todo `/dashboard`:
- **Sidebar fixa (desktop) / tab bar (mobile)** em `dashboard/layout.tsx`
  — substitui os links de navegação ad hoc que cada página
  reimplementava do seu jeito (Pacientes, Configurar, Voltar). Inclui
  busca global de paciente (Ctrl/Cmd+K) filtrando no cliente.
- **Dashboard**: hero com nome/logo/números do dia + "Primeiros passos"
  virou stepper horizontal com progresso, em vez de checklist vertical.
- **Agenda**: formulário de agendamento manual virou painel fixo ao
  lado da grade em telas largas (antes era um `<details>` recolhido no
  fim da página); coluna de horários fica fixa (`sticky`) ao rolar a
  grade na horizontal no mobile com mais de um profissional; status
  (pendente/confirmado/cancelado) ganhou um glifo (●/✓/✕) além da cor,
  pra não depender só de cor (WCAG 1.4.1).
- **Paciente ↔ agenda**: agendamento do paciente na agenda linka pro
  cadastro dele quando `patient_id` existe; cadastro do paciente tem
  botão "Nova consulta" que abre a agenda com ele pré-selecionado.
- **Confirmação + desfazer**: cancelar consulta e remover paciente
  pedem confirmação (`window.confirm`) e oferecem "Desfazer" no toast
  de sucesso. Remover paciente passou a ser soft-delete (`deleted_at`,
  migration 0012) — reversível, e mantém o histórico de consultas já
  ligadas a ele.
- **getTenantContext()** (`lib/tenant.ts`): auth + perfil + tenant numa
  chamada só, memoizada por request (`cache()` do React) — layout e
  cada página sob `/dashboard` chamam de novo sem repetir a ida ao
  banco.

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

**Visões diário/semanal/mensal desde 2026-10-08** (`?view=day|week|month`
em `/dashboard/agenda`, data compartilhada entre as abas): diário é a
grade por profissional já existente; semanal e mensal são resumo
somente-leitura (lista por dia / grade de pontos coloridos por status)
que leva de volta ao diário ao clicar — é lá que ficam as ações
(confirmar, cancelar, agendar).

**Marcação direta na grade** (view diário): clicar num horário livre da
coluna de um profissional abre o formulário "Agendar manualmente" já
preenchido com profissional + horário — alternativa ao preenchimento
manual completo, não substitui (a grade não valida contra o expediente
cadastrado, igual o formulário manual já não validava — só a página
pública de agendamento respeita `working_hours`).

**Recorrência** (semanal/quinzenal/mensal, até 12 ocorrências por
série): cada ocorrência é um agendamento independente, criado via a
mesma RPC `book_appointment` de sempre (overlap, serviço ativo etc.) e
com sua própria pergunta de confirmação por WhatsApp — se uma data
colidir, as outras da série continuam sendo criadas. Simplificação
deliberada: as ocorrências não ficam ligadas entre si no banco (não há
"cancelar a série toda" ainda); cancelar/confirmar é sempre por
ocorrência, na view diário.

**Cores de status desde 2026-10-08** (grade, legenda, semanal e
mensal): azul = paciente respondeu "1" (confirmou) no WhatsApp,
vermelho = paciente respondeu "2" ou a equipe cancelou, amarelo = ainda
sem resposta. Concluído/faltou seguem neutros (cinza), sem relação com
confirmação.

### F2 — Paciente + Prontuário
~~Cadastro de paciente~~ **cadastro básico implementado em 2026-10-08**
(`/dashboard/pacientes` — nome, telefone, e-mail, observações). Falta:
evolução clínica (SOAP), anexos, assinatura digital do registro (CFM
Resolução 1.821/2007), retenção de 20 anos desde o schema (mesmo sem UI
de exclusão).

**Agendamento ligado ao cadastro de paciente desde 2026-10-08**: um
`<select>` com os pacientes de `/dashboard/pacientes` preenche
nome/telefone/e-mail do form de agendamento manual ao escolher um — os
campos continuam editáveis pra quem ainda não tem cadastro. Por baixo,
`appointments.patient_id` (migration 0011) é resolvido dentro da mesma
RPC `book_appointment` usada por todo agendamento (manual ou link
público): casa por telefone com um paciente já cadastrado no tenant
(últimos 9 dígitos, tolera formatação diferente) ou cria o cadastro na
hora se não achar nenhum — sem sobrescrever um cadastro já existente.
Falta ainda: UI de histórico de consultas a partir do cadastro do
paciente (o vínculo no banco já existe, só não tem tela pra navegar
por ele).

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
