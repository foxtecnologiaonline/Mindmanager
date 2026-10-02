"use client";

import { useMemo, useState, useTransition } from "react";
import { bookPublicAppointment, getAvailableSlots } from "@/lib/scheduling/actions";

type ServiceRow = {
  professionalId: string;
  professionalName: string;
  serviceTypeId: string;
  serviceName: string;
  durationMinutes: number;
  priceCents: number | null;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Telefone BR: DDD (2) + número (8 ou 9 dígitos), com ou sem +55/9º dígito.
function isValidBrazilPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  return local.length === 10 || local.length === 11;
}

export function BookingForm({
  tenantSlug,
  services,
}: {
  tenantSlug: string;
  services: ServiceRow[];
}) {
  const professionals = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of services) map.set(s.professionalId, s.professionalName);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [services]);

  const [professionalId, setProfessionalId] = useState(professionals[0]?.id ?? "");
  const servicesForProfessional = services.filter(
    (s) => s.professionalId === professionalId,
  );
  const [serviceTypeId, setServiceTypeId] = useState(
    servicesForProfessional[0]?.serviceTypeId ?? "",
  );
  const [date, setDate] = useState(todayISO());
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(
    null,
  );

  function handleProfessionalChange(id: string) {
    setProfessionalId(id);
    const first = services.find((s) => s.professionalId === id);
    setServiceTypeId(first?.serviceTypeId ?? "");
    setSlots([]);
    setSelectedSlot(null);
  }

  function loadSlots() {
    if (!professionalId || !serviceTypeId || !date) return;
    setSelectedSlot(null);
    setMessage(null);
    startTransition(async () => {
      const result = await getAvailableSlots(professionalId, serviceTypeId, date);
      setSlots(result.slots);
    });
  }

  function submitBooking() {
    if (!selectedSlot) return;
    if (!isValidBrazilPhone(patientPhone)) {
      setMessage({
        type: "error",
        text: "Telefone inválido. Informe DDD + número (ex: 11 91234-5678).",
      });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await bookPublicAppointment({
        tenantSlug,
        professionalId,
        serviceTypeId,
        patientName,
        patientPhone,
        patientEmail,
        startsAt: selectedSlot,
      });

      if (!result.success) {
        setMessage({ type: "error", text: result.error ?? "Não foi possível agendar." });
        return;
      }

      setMessage({ type: "success", text: "Consulta agendada com sucesso!" });
      setSlots((prev) => prev.filter((s) => s !== selectedSlot));
      setSelectedSlot(null);
      setPatientName("");
      setPatientPhone("");
      setPatientEmail("");
    });
  }

  if (professionals.length === 0) {
    return (
      <p className="text-sm text-muted-soft">
        Nenhum horário disponível para agendamento no momento.
      </p>
    );
  }

  return (
    <div className="card space-y-4 p-6 text-sm">
      <div className="space-y-1">
        <label className="font-medium text-ink">Profissional</label>
        <select
          value={professionalId}
          onChange={(e) => handleProfessionalChange(e.target.value)}
          className="input"
        >
          {professionals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="font-medium text-ink">Tipo de consulta</label>
        <select
          value={serviceTypeId}
          onChange={(e) => {
            setServiceTypeId(e.target.value);
            setSlots([]);
            setSelectedSlot(null);
          }}
          className="input"
        >
          {servicesForProfessional.map((s) => (
            <option key={s.serviceTypeId} value={s.serviceTypeId}>
              {s.serviceName} ({s.durationMinutes}min)
              {s.priceCents != null && ` — R$ ${(s.priceCents / 100).toFixed(2)}`}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="font-medium text-ink">Data</label>
        <input
          type="date"
          value={date}
          min={todayISO()}
          onChange={(e) => {
            setDate(e.target.value);
            setSlots([]);
            setSelectedSlot(null);
          }}
          className="input"
        />
      </div>

      <button type="button" onClick={loadSlots} disabled={isPending} className="btn-secondary">
        Ver horários disponíveis
      </button>

      {slots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => setSelectedSlot(slot)}
              className={
                selectedSlot === slot
                  ? "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-accent-soft"
              }
            >
              {new Date(slot).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "America/Sao_Paulo",
              })}
            </button>
          ))}
        </div>
      )}

      {slots.length === 0 && date && (
        <p className="text-muted-soft">
          Clique em &quot;Ver horários disponíveis&quot; para essa data.
        </p>
      )}

      {selectedSlot && (
        <div className="space-y-3 rounded-xl border border-border bg-paper p-4">
          <div className="space-y-1">
            <label className="font-medium text-ink">Nome completo</label>
            <input
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              required
              className="input"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-ink">Telefone (WhatsApp)</label>
            <input
              value={patientPhone}
              onChange={(e) => setPatientPhone(e.target.value)}
              required
              placeholder="55119..."
              className="input"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-ink">E-mail (opcional)</label>
            <input
              type="email"
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
              className="input"
            />
          </div>
          <button
            type="button"
            onClick={submitBooking}
            disabled={isPending || !patientName || !patientPhone}
            className="btn-primary w-full"
          >
            {isPending ? "Agendando..." : "Confirmar agendamento"}
          </button>
        </div>
      )}

      {message && (
        <p
          className={`rounded-lg p-2 ${
            message.type === "error" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
