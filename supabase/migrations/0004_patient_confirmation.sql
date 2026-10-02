-- F1: confirmação de agendamento pelo paciente (sim/não via WhatsApp)
--
-- Todo agendamento novo nasce "pending": o paciente recebe uma pergunta
-- (SIM confirma, NÃO cancela) e a resposta muda o status. A equipe também
-- pode confirmar/cancelar manualmente pelo dashboard (fallback para quando
-- o Twilio não está configurado, ou o paciente responde por telefone).

alter table public.appointments drop constraint appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show'));

alter table public.appointments alter column status set default 'pending';
