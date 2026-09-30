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
      <p className="text-sm text-neutral-500">
        Nenhum horário disponível para agendamento no momento.
      </p>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <label className="font-medium">Profissional</label>
        <select
          value={professionalId}
          onChange={(e) => handleProfessionalChange(e.target.value)}
          className="w-full rounded border px-3 py-2"
        >
          {professionals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="font-medium">Tipo de consulta</label>
        <select
          value={serviceTypeId}
          onChange={(e) => {
            setServiceTypeId(e.target.value);
            setSlots([]);
            setSelectedSlot(null);
          }}
          className="w-full rounded border px-3 py-2"
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
        <label className="font-medium">Data</label>
        <input
          type="date"
          value={date}
          min={todayISO()}
          onChange={(e) => {
            setDate(e.target.value);
            setSlots([]);
            setSelectedSlot(null);
          }}
          className="w-full rounded border px-3 py-2"
        />
      </div>

      <button
        type="button"
        onClick={loadSlots}
        disabled={isPending}
        className="rounded border px-4 py-2"
      >
        Ver horários disponíveis
      </button>

      {slots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => setSelectedSlot(slot)}
              className={`rounded border px-3 py-1 ${
                selectedSlot === slot ? "bg-black text-white" : ""
              }`}
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
        <p className="text-neutral-500">
          Clique em &quot;Ver horários disponíveis&quot; para essa data.
        </p>
      )}

      {selectedSlot && (
        <div className="space-y-3 rounded border p-4">
          <div className="space-y-1">
            <label className="font-medium">Nome completo</label>
            <input
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              required
              className="w-full rounded border px-3 py-2"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium">Telefone (WhatsApp)</label>
            <input
              value={patientPhone}
              onChange={(e) => setPatientPhone(e.target.value)}
              required
              placeholder="55119..."
              className="w-full rounded border px-3 py-2"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium">E-mail (opcional)</label>
            <input
              type="email"
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
              className="w-full rounded border px-3 py-2"
            />
          </div>
          <button
            type="button"
            onClick={submitBooking}
            disabled={isPending || !patientName || !patientPhone}
            className="w-full rounded bg-black py-2 text-white disabled:opacity-50"
          >
            {isPending ? "Agendando..." : "Confirmar agendamento"}
          </button>
        </div>
      )}

      {message && (
        <p
          className={`rounded p-2 ${
            message.type === "error" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
